"""
WebSocket server using Python stdlib only (no FastAPI/uvicorn required).
Serves:
  ws://localhost:8765  -> live transaction stream with fraud scores
  http://localhost:8766 -> REST endpoints (metrics, history, manual test)
"""
import asyncio
import json
import sys
import os
import time
import threading
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

# Ensure imports work from project root
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend.detector import FraudDetector
from backend.producer import TransactionProducer
from backend.stream_processor import FraudStreamProcessor

# ---------- Shared state ----------
detector = FraudDetector(threshold=0.5)
producer = TransactionProducer(fraud_rate=0.06)
recent_transactions = []  # circular buffer
MAX_HISTORY = 500
metrics_cache = {}
stream_running = False
processor = None

def add_to_history(result):
    recent_transactions.append(result)
    if len(recent_transactions) > MAX_HISTORY:
        recent_transactions.pop(0)

# ---------- WebSocket server ----------
try:
    import websockets

    connected_clients = set()

    async def alert_handler(result):
        """Called by processor when fraud detected."""
        pass  # broadcast happens in main loop

    async def ws_handler(websocket):
        connected_clients.add(websocket)
        try:
            # Send history on connect
            history_msg = json.dumps({
                "type": "history",
                "data": recent_transactions[-50:]
            })
            await websocket.send(history_msg)
            await websocket.wait_closed()
        finally:
            connected_clients.discard(websocket)

    async def stream_loop():
        global processor, stream_running, metrics_cache
        processor = FraudStreamProcessor(detector, alert_callback=alert_handler)
        stream_running = True
        interval = 0.6  # ~100 txn/min

        while stream_running:
            txn = producer.generate_transaction()
            result = await processor.process(txn)
            add_to_history(result)
            metrics_cache = processor.get_metrics()

            # Broadcast to all connected WS clients
            msg = json.dumps({
                "type": "transaction",
                "data": result,
                "metrics": metrics_cache
            }, default=str)

            if connected_clients:
                await asyncio.gather(
                    *[client.send(msg) for client in list(connected_clients)],
                    return_exceptions=True
                )

            await asyncio.sleep(interval)

    async def main_ws():
        async with websockets.serve(ws_handler, "localhost", 8765):
            print("WebSocket server: ws://localhost:8765")
            await stream_loop()

    WEBSOCKETS_AVAILABLE = True
except ImportError:
    WEBSOCKETS_AVAILABLE = False
    print("websockets not available - using polling mode")

# ---------- HTTP REST server ----------
class APIHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass  # silence access logs

    def _json(self, data, status=200):
        body = json.dumps(data, default=str).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", len(body))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.end_headers()

    def do_GET(self):
        path = urlparse(self.path).path

        if path == "/metrics":
            self._json(metrics_cache or {"status": "starting"})

        elif path == "/transactions":
            qs = parse_qs(urlparse(self.path).query)
            limit = int(qs.get("limit", [50])[0])
            fraud_only = qs.get("fraud_only", ["false"])[0] == "true"
            data = recent_transactions[-limit:]
            if fraud_only:
                data = [t for t in data if t.get("is_fraud")]
            self._json({"transactions": data, "total": len(recent_transactions)})

        elif path == "/feature-info":
            self._json(detector.feature_info)

        elif path == "/health":
            self._json({"status": "ok", "model_loaded": True, "streaming": stream_running})

        elif path == "/poll":
            # Polling endpoint for when WebSocket unavailable
            qs = parse_qs(urlparse(self.path).query)
            since_idx = int(qs.get("since", [max(0, len(recent_transactions)-10)])[0])
            new_txns = recent_transactions[since_idx:]
            self._json({
                "transactions": new_txns,
                "total_index": len(recent_transactions),
                "metrics": metrics_cache
            })

        else:
            self._json({"error": "not found"}, 404)

    def do_POST(self):
        path = urlparse(self.path).path

        if path == "/score":
            length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(length))
            # Manual transaction scoring
            txn = body if "features" in body else {
                **body,
                "transaction_id": "manual-test",
                "user_id": "test-user",
                "timestamp": str(__import__("datetime").datetime.now().isoformat()),
                "merchant_name": "Manual Test",
                "card_network": "Visa",
                "features": body,
            }
            result = detector.score(txn)
            self._json(result)
        else:
            self._json({"error": "not found"}, 404)


def run_http_server():
    server = HTTPServer(("localhost", 8766), APIHandler)
    print("HTTP API server: http://localhost:8766")
    server.serve_forever()


def run_polling_stream():
    """Fallback: run streaming loop in a thread for polling mode."""
    global processor, stream_running, metrics_cache

    async def _stream():
        global processor, stream_running, metrics_cache
        processor = FraudStreamProcessor(detector)
        stream_running = True
        while True:
            txn = producer.generate_transaction()
            result = await processor.process(txn)
            add_to_history(result)
            metrics_cache = processor.get_metrics()
            await asyncio.sleep(0.6)

    asyncio.run(_stream())


if __name__ == "__main__":
    print("=== Fraud Detection Pipeline Server ===")
    print(f"Model AUC: {detector.feature_info.get('auc', 'N/A')}")

    # Start HTTP server in background thread
    http_thread = threading.Thread(target=run_http_server, daemon=True)
    http_thread.start()

    if WEBSOCKETS_AVAILABLE:
        print("Starting WebSocket streaming...")
        asyncio.run(main_ws())
    else:
        print("Starting polling-mode streaming...")
        run_polling_stream()
