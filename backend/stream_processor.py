"""
Streaming processor - simulates Apache Flink/Spark Structured Streaming.

In production architecture:
  Kafka topic (transactions) -> Flink job -> fraud_scored topic -> alerts topic

Here: same pipeline in-process with windowed aggregation and stateful operators.
"""
import asyncio
import time
from collections import deque, defaultdict
from typing import Dict, Any, Optional, Callable, Awaitable
from datetime import datetime

class StreamingWindow:
    """Tumbling/sliding window over transaction stream."""

    def __init__(self, window_seconds: int = 60):
        self.window_seconds = window_seconds
        self._buffer: deque = deque()

    def add(self, item: Dict):
        now = time.time()
        self._buffer.append((now, item))
        # Evict expired entries
        while self._buffer and (now - self._buffer[0][0]) > self.window_seconds:
            self._buffer.popleft()

    def get_window(self):
        return [item for _, item in self._buffer]

    @property
    def count(self):
        return len(self._buffer)


class FraudStreamProcessor:
    """
    Stateful stream processor - mimics Flink DataStream API operators.

    Operators:
      1. map (feature extraction) -> already done in producer
      2. keyBy (user_id) -> per-user velocity windows
      3. process (ML scoring) -> FraudDetector.score()
      4. filter (fraud flag) -> alert queue
      5. aggregate (stats window) -> dashboard metrics
    """

    def __init__(self, detector, alert_callback: Optional[Callable] = None):
        self.detector = detector
        self.alert_callback = alert_callback

        # Keyed state (by user_id) - simulates Flink's ValueState
        self._user_windows: Dict[str, StreamingWindow] = defaultdict(lambda: StreamingWindow(3600))

        # Global 60s stats window
        self._stats_window = StreamingWindow(60)

        # Metrics
        self.metrics = {
            "total_processed": 0,
            "total_fraud": 0,
            "total_amount": 0.0,
            "fraud_amount": 0.0,
            "throughput_per_min": 0,
            "avg_latency_ms": 0.0,
            "risk_distribution": {"CRITICAL": 0, "HIGH": 0, "MEDIUM": 0, "LOW": 0},
        }
        self._latencies: deque = deque(maxlen=100)

    async def process(self, transaction: Dict[str, Any]) -> Dict[str, Any]:
        """
        Main processing pipeline. Returns scored transaction.
        """
        t0 = time.perf_counter()

        # --- Operator 1: keyBy user, update velocity state ---
        uid = transaction["user_id"]
        self._user_windows[uid].add(transaction)

        # --- Operator 2: ML scoring (map) ---
        result = self.detector.score(transaction)

        # --- Operator 3: alert filter ---
        if result["is_fraud"] and self.alert_callback:
            await self.alert_callback(result)

        # --- Operator 4: aggregate into stats window ---
        self._stats_window.add(result)

        # --- Update metrics ---
        latency_ms = (time.perf_counter() - t0) * 1000
        self._latencies.append(latency_ms)

        self.metrics["total_processed"] += 1
        self.metrics["total_amount"] += transaction["amount"]
        if result["is_fraud"]:
            self.metrics["total_fraud"] += 1
            self.metrics["fraud_amount"] += transaction["amount"]
        self.metrics["risk_distribution"][result["risk_level"]] += 1
        self.metrics["avg_latency_ms"] = round(sum(self._latencies) / len(self._latencies), 2)
        self.metrics["throughput_per_min"] = self._stats_window.count

        return result

    def get_window_stats(self) -> Dict:
        window = self._stats_window.get_window()
        if not window:
            return {}

        fraud_in_window = [t for t in window if t["is_fraud"]]
        amounts = [t["amount"] for t in window]
        probs = [t["fraud_probability"] for t in window]

        return {
            "window_transactions": len(window),
            "window_fraud": len(fraud_in_window),
            "window_fraud_rate": round(len(fraud_in_window) / max(len(window), 1), 4),
            "window_avg_amount": round(sum(amounts) / max(len(amounts), 1), 2),
            "window_avg_fraud_prob": round(sum(probs) / max(len(probs), 1), 4),
            "window_amount_at_risk": round(sum(t["amount"] for t in fraud_in_window), 2),
        }

    def get_metrics(self) -> Dict:
        total = max(self.metrics["total_processed"], 1)
        return {
            **self.metrics,
            "fraud_rate": round(self.metrics["total_fraud"] / total, 4),
            "avg_fraud_prob": 0,  # computed from window
            **self.get_window_stats(),
        }
