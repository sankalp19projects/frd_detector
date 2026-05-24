"""
Production Kafka integration.
Requires: pip install confluent-kafka

To use:
  1. Start Kafka broker (docker-compose up)
  2. Set KAFKA_BOOTSTRAP in env or config
  3. Replace TransactionProducer with KafkaTransactionProducer
  4. Replace FraudStreamProcessor with KafkaFraudConsumer
"""
import json
import os
from typing import Dict, Any

KAFKA_BOOTSTRAP = os.getenv("KAFKA_BOOTSTRAP", "localhost:9092")
TRANSACTIONS_TOPIC = "transactions"
SCORED_TOPIC = "fraud_scored"
ALERTS_TOPIC = "fraud_alerts"

# ── Producer ────────────────────────────────────────────────────────────────
class KafkaTransactionProducer:
    """Wraps confluent_kafka.Producer for transaction streaming."""

    def __init__(self, bootstrap: str = KAFKA_BOOTSTRAP):
        # Lazy import so module loads without confluent_kafka installed
        from confluent_kafka import Producer
        self.producer = Producer({
            "bootstrap.servers": bootstrap,
            "client.id": "fraud-txn-producer",
            "acks": "1",
            "linger.ms": 5,
            "batch.size": 65536,
        })
        self._sim_producer = None  # Fallback to simulated producer

    @staticmethod
    def _delivery_report(err, msg):
        if err:
            print(f"[Kafka] Delivery failed: {err}")

    def send(self, transaction: Dict[str, Any]):
        payload = json.dumps(transaction, default=str).encode()
        self.producer.produce(
            TRANSACTIONS_TOPIC,
            key=transaction["user_id"].encode(),
            value=payload,
            callback=self._delivery_report,
        )
        self.producer.poll(0)

    def flush(self):
        self.producer.flush()


# ── Consumer / Fraud processor ──────────────────────────────────────────────
class KafkaFraudConsumer:
    """
    Consumes from 'transactions' topic, scores, produces to 'fraud_scored'.
    Run as: python -m backend.kafka_integration
    """

    def __init__(self, detector, bootstrap: str = KAFKA_BOOTSTRAP, group_id: str = "fraud-detector"):
        from confluent_kafka import Consumer, Producer
        self.detector = detector
        self.consumer = Consumer({
            "bootstrap.servers": bootstrap,
            "group.id": group_id,
            "auto.offset.reset": "latest",
            "enable.auto.commit": True,
        })
        self.producer = Producer({"bootstrap.servers": bootstrap})
        self.consumer.subscribe([TRANSACTIONS_TOPIC])
        print(f"[Kafka] Subscribed to {TRANSACTIONS_TOPIC}")

    def run(self):
        """Main consumer loop — analogous to Flink DataStream job."""
        try:
            while True:
                msg = self.consumer.poll(1.0)
                if msg is None:
                    continue
                if msg.error():
                    print(f"[Kafka] Consumer error: {msg.error()}")
                    continue

                txn = json.loads(msg.value().decode())
                result = self.detector.score(txn)

                # Produce to scored topic
                self.producer.produce(
                    SCORED_TOPIC,
                    key=txn["user_id"].encode(),
                    value=json.dumps(result, default=str).encode(),
                )

                # Produce alert if fraud
                if result["is_fraud"]:
                    alert = {
                        "transaction_id": result["transaction_id"],
                        "user_id": result["user_id"],
                        "fraud_probability": result["fraud_probability"],
                        "risk_level": result["risk_level"],
                        "amount": result["amount"],
                        "top_factors": result["top_factors"][:3],
                    }
                    self.producer.produce(
                        ALERTS_TOPIC,
                        key=txn["user_id"].encode(),
                        value=json.dumps(alert).encode(),
                    )
                    print(f"[ALERT] {result['risk_level']} | {result['transaction_id']} | ${result['amount']:.2f} | {result['fraud_probability']:.2%}")

                self.producer.poll(0)

        except KeyboardInterrupt:
            pass
        finally:
            self.consumer.close()
            self.producer.flush()
            print("[Kafka] Shutdown complete")


# ── Docker Compose reference ─────────────────────────────────────────────────
DOCKER_COMPOSE = """
version: '3.8'
services:
  zookeeper:
    image: confluentinc/cp-zookeeper:7.5.0
    environment:
      ZOOKEEPER_CLIENT_PORT: 2181
    ports: ["2181:2181"]

  kafka:
    image: confluentinc/cp-kafka:7.5.0
    depends_on: [zookeeper]
    ports: ["9092:9092"]
    environment:
      KAFKA_BROKER_ID: 1
      KAFKA_ZOOKEEPER_CONNECT: zookeeper:2181
      KAFKA_ADVERTISED_LISTENERS: PLAINTEXT://localhost:9092
      KAFKA_AUTO_CREATE_TOPICS_ENABLE: "true"
      KAFKA_NUM_PARTITIONS: 3
      KAFKA_DEFAULT_REPLICATION_FACTOR: 1

  kafka-ui:
    image: provectuslabs/kafka-ui:latest
    depends_on: [kafka]
    ports: ["8080:8080"]
    environment:
      KAFKA_CLUSTERS_0_BOOTSTRAPSERVERS: kafka:9092
"""

if __name__ == "__main__":
    # Run as standalone Kafka consumer
    import sys, os
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    from backend.detector import FraudDetector
    detector = FraudDetector()
    consumer = KafkaFraudConsumer(detector)
    consumer.run()
