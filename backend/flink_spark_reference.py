"""
Production Flink / Spark Structured Streaming integration reference.

Flink:  pip install apache-flink
Spark:  pip install pyspark
"""

# ════════════════════════════════════════════════════════════════
#  APACHE FLINK — DataStream API
# ════════════════════════════════════════════════════════════════
FLINK_JOB = """
# flink_fraud_job.py
# Run: flink run -py flink_fraud_job.py

from pyflink.datastream import StreamExecutionEnvironment, TimeCharacteristic
from pyflink.datastream.connectors.kafka import FlinkKafkaConsumer, FlinkKafkaProducer
from pyflink.common.serialization import SimpleStringSchema
from pyflink.common.typeinfo import Types
import json, pickle, sys

env = StreamExecutionEnvironment.get_execution_environment()
env.set_stream_time_characteristic(TimeCharacteristic.EventTime)
env.set_parallelism(4)

# Add Kafka connector JAR (adjust path)
env.add_jars("file:///opt/flink/lib/flink-connector-kafka-3.0.0.jar")

kafka_consumer = FlinkKafkaConsumer(
    topics="transactions",
    deserialization_schema=SimpleStringSchema(),
    properties={"bootstrap.servers": "localhost:9092", "group.id": "flink-fraud"},
)
kafka_consumer.set_start_from_latest()

class FraudScoringMapFunction:
    def __init__(self):
        self.detector = None

    def open(self, runtime_context):
        # Load model in each parallel worker
        import pickle
        with open("models/fraud_model.pkl", "rb") as f:
            artifacts = pickle.load(f)
        self.model = artifacts["model"]
        self.scaler = artifacts["scaler"]

    def map(self, value):
        from backend.detector import FraudDetector
        if self.detector is None:
            self.detector = FraudDetector()
        txn = json.loads(value)
        result = self.detector.score(txn)
        return json.dumps(result)

# Pipeline
stream = (
    env.add_source(kafka_consumer)
       .map(FraudScoringMapFunction(), output_type=Types.STRING())
       .filter(lambda x: json.loads(x).get("is_fraud", False))
)

# Produce alerts
kafka_producer = FlinkKafkaProducer(
    topic="fraud_alerts",
    serialization_schema=SimpleStringSchema(),
    producer_config={"bootstrap.servers": "localhost:9092"},
)
stream.add_sink(kafka_producer)

env.execute("FraudDetectionJob")
"""

# ════════════════════════════════════════════════════════════════
#  APACHE SPARK — Structured Streaming
# ════════════════════════════════════════════════════════════════
SPARK_JOB = """
# spark_fraud_job.py
# Run: spark-submit --packages org.apache.spark:spark-sql-kafka-0-10_2.12:3.4.0 spark_fraud_job.py

from pyspark.sql import SparkSession
from pyspark.sql.functions import from_json, col, udf, current_timestamp
from pyspark.sql.types import StructType, StructField, StringType, DoubleType, BooleanType
import json, pickle

spark = (
    SparkSession.builder
    .appName("FraudDetectionStreaming")
    .config("spark.streaming.stopGracefullyOnShutdown", True)
    .getOrCreate()
)
spark.sparkContext.setLogLevel("WARN")

# Schema matching TransactionProducer output
TXN_SCHEMA = StructType([
    StructField("transaction_id", StringType()),
    StructField("user_id", StringType()),
    StructField("amount", DoubleType()),
    StructField("merchant_name", StringType()),
    StructField("merchant_category", DoubleType()),
    StructField("country", StringType()),
    # ... features sub-struct would be defined here
])

raw_stream = (
    spark.readStream
    .format("kafka")
    .option("kafka.bootstrap.servers", "localhost:9092")
    .option("subscribe", "transactions")
    .option("startingOffsets", "latest")
    .load()
)

parsed = raw_stream.select(
    from_json(col("value").cast("string"), TXN_SCHEMA).alias("data")
).select("data.*")

# UDF for ML scoring (broadcast model to all executors)
MODEL_PATH = "models/fraud_model.pkl"
_model_bc = None

def score_udf(features_json):
    global _model_bc
    if _model_bc is None:
        import pickle
        with open(MODEL_PATH, "rb") as f:
            _model_bc = pickle.load(f)
    import json, numpy as np
    features = json.loads(features_json)
    # ... extract feature vector, score
    return 0.5  # placeholder

score_fn = udf(score_udf, DoubleType())

scored = parsed.withColumn("fraud_prob", score_fn(col("features_json")))
fraud_alerts = scored.filter(col("fraud_prob") >= 0.5)

# Write to Kafka alerts topic
query = (
    fraud_alerts.selectExpr("CAST(transaction_id AS STRING) AS key", "to_json(struct(*)) AS value")
    .writeStream
    .format("kafka")
    .option("kafka.bootstrap.servers", "localhost:9092")
    .option("topic", "fraud_alerts")
    .option("checkpointLocation", "/tmp/fraud-checkpoint")
    .outputMode("append")
    .trigger(processingTime="1 second")
    .start()
)

query.awaitTermination()
"""

print("Flink and Spark integration reference code.")
print("See kafka_integration.py for Kafka producer/consumer.")
print("Run backend/server.py for local simulation mode.")
