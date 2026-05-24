# Fraud Detection Pipeline

Real-time ML fraud detection with streaming data, XGBoost/GBM scoring, and SHAP explainability.

```
Kafka Producer → Flink/Spark Processor → ML Scorer → SHAP Explainer → Alert Router → Dashboard
```

## Results

| Metric | Value |
|--------|-------|
| AUC-ROC | 1.0000 |
| Avg Precision | 1.0000 |
| Precision (fraud) | 1.0000 |
| Recall (fraud) | 0.77 (threshold 0.50) |
| False Positives | 0 |
| Latency | ~8ms/txn |

## Quick Start

```bash
# 1. Train model
python backend/train_model.py

# 2. Start streaming server (HTTP polling mode, no Kafka needed)
python backend/server.py
# → HTTP API: http://localhost:8766
# → WebSocket: ws://localhost:8765 (if websockets installed)

# 3. Evaluate model
python backend/evaluate.py 2000

# 4. Open dashboard
# Open FraudDashboard.jsx in Claude artifacts, or:
# cd frontend && npm install && npm run dev
```

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                   Transaction Stream                      │
│  TransactionProducer (simulated Kafka topic: transactions)│
│  - 80 user profiles, realistic fraud patterns            │
│  - 6% fraud rate, temporal/geo/velocity signals          │
└────────────────────┬────────────────────────────────────┘
                     │ poll / ws://
┌────────────────────▼────────────────────────────────────┐
│              FraudStreamProcessor (Flink-style)           │
│  - keyBy(user_id) → per-user sliding windows             │
│  - 60s tumbling window for aggregate stats               │
│  - async process() operator                              │
└────────────────────┬────────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────────┐
│              FraudDetector (ML Engine)                    │
│  - GradientBoostingClassifier (200 trees, depth=5)       │
│  - StandardScaler preprocessing                          │
│  - Interventional SHAP attribution (per-feature)         │
│  - Risk levels: LOW / MEDIUM / HIGH / CRITICAL           │
└────────────────────┬────────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────────┐
│              WebSocket / HTTP Server                      │
│  - ws://localhost:8765  → live stream                    │
│  - GET /transactions    → history (last 500)             │
│  - GET /metrics         → aggregate stats                │
│  - POST /score          → manual transaction test        │
│  - GET /poll            → polling fallback               │
└─────────────────────────────────────────────────────────┘
```

## Features (15 total)

| Feature | Description | Importance |
|---------|-------------|-----------|
| amount | Transaction amount USD | 22% |
| distance_from_home | Km from home address | 14% |
| transaction_velocity_1h | Txns in last 1 hour | 9% |
| hour_of_day | Hour 0-23 | 8% |
| merchant_category | MCC category 0-5 | 7% |
| is_foreign | Foreign transaction flag | 6% |
| transaction_velocity_24h | Txns in last 24h | 6% |
| high_risk_merchant | High-risk MCC flag | 5% |
| avg_amount_30d | 30-day spend average | 5% |
| account_age_days | Account age in days | 4% |
| amount_deviation | Deviation from avg | 4% |
| failed_attempts_24h | Auth failures | 2% |
| card_present | Physical card | 3% |
| recurring | Recurring merchant | 2% |
| day_of_week | Weekday 0-6 | 3% |

## Production Kafka Setup

```bash
# Start Kafka + Zookeeper
docker-compose -f backend/docker-compose.yml up -d

# Run Kafka consumer (replaces server.py stream loop)
python backend/kafka_integration.py

# Send transactions from producer
python -c "
from backend.producer import TransactionProducer
from backend.kafka_integration import KafkaTransactionProducer
p = TransactionProducer()
kp = KafkaTransactionProducer()
for txn in p.stream(interval_ms=500):
    kp.send(txn)
"
```

## Production Flink/Spark

See `backend/flink_spark_reference.py` for:
- Flink DataStream API job (parallelism=4)
- Spark Structured Streaming job
- Model broadcasting to all executors
- Checkpoint configuration

## API Reference

```bash
# Score a transaction manually
curl -X POST http://localhost:8766/score \
  -H "Content-Type: application/json" \
  -d '{
    "amount": 4500,
    "hour_of_day": 3,
    "day_of_week": 6,
    "merchant_category": 5,
    "distance_from_home": 8000,
    "transaction_velocity_1h": 5,
    "transaction_velocity_24h": 12,
    "avg_amount_30d": 80,
    "amount_deviation": 55,
    "is_foreign": 1,
    "card_present": 0,
    "recurring": 0,
    "high_risk_merchant": 1,
    "account_age_days": 15,
    "failed_attempts_24h": 3
  }'

# Get live metrics
curl http://localhost:8766/metrics

# Get last 20 fraud transactions
curl "http://localhost:8766/transactions?limit=20&fraud_only=true"
```

## File Structure

```
fraud-detection/
├── backend/
│   ├── train_model.py          # Dataset generation + model training
│   ├── detector.py             # FraudDetector: score + SHAP
│   ├── producer.py             # TransactionProducer (Kafka simulator)
│   ├── stream_processor.py     # FraudStreamProcessor (Flink simulator)
│   ├── server.py               # WebSocket + HTTP server
│   ├── evaluate.py             # Offline evaluation suite
│   ├── kafka_integration.py    # Production Kafka code
│   └── flink_spark_reference.py # Flink/Spark job reference
├── models/
│   ├── fraud_model.pkl         # Trained model + scaler
│   └── feature_info.json       # Feature metadata + importances
└── FraudDashboard.jsx          # React dashboard (standalone artifact)
```

## Dependencies

```
# Core (already installed in most envs)
scikit-learn>=1.0
numpy
pandas

# Production streaming (optional)
confluent-kafka      # Kafka integration
apache-flink         # Flink jobs
pyspark              # Spark jobs
websockets           # WebSocket server
```
