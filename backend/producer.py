"""
Simulates a Kafka producer streaming transactions.
In production: replace with confluent_kafka.Producer.
"""
import numpy as np
import random
import time
import uuid
from datetime import datetime

np.random.seed(None)  # fresh seed per run

MERCHANT_NAMES = {
    0: ["Amazon", "Walmart", "Target", "Costco", "Best Buy"],
    1: ["Shell", "BP", "Exxon", "Chevron", "Sunoco"],
    2: ["Marriott", "Hilton", "Airbnb", "Delta", "United Airlines"],
    3: ["Coinbase", "Binance", "FTX", "Kraken", "Gemini"],
    4: ["Western Union", "MoneyGram", "Xoom", "Wise", "Remitly"],
    5: ["OnlyFans", "AdultTime", "VPN Service", "Dark Web Market", "Offshore Casino"],
}

CARD_NETWORKS = ["Visa", "Mastercard", "Amex", "Discover"]
COUNTRIES = ["US", "UK", "CA", "DE", "FR", "CN", "RU", "BR", "NG", "UA"]

class TransactionProducer:
    """Simulates Kafka topic: transactions"""

    def __init__(self, fraud_rate=0.04):
        self.fraud_rate = fraud_rate
        self.user_profiles = self._generate_user_profiles(100)

    def _generate_user_profiles(self, n):
        profiles = []
        for _ in range(n):
            profiles.append({
                "user_id": str(uuid.uuid4())[:8],
                "home_lat": random.uniform(25, 48),
                "home_lon": random.uniform(-120, -70),
                "avg_amount": np.random.lognormal(3.8, 0.8),
                "account_age_days": np.random.gamma(5, 200),
                "card_network": random.choice(CARD_NETWORKS),
            })
        return profiles

    def _haversine_km(self, lat1, lon1, lat2, lon2):
        from math import radians, sin, cos, sqrt, atan2
        R = 6371
        dlat = radians(lat2 - lat1)
        dlon = radians(lon2 - lon1)
        a = sin(dlat/2)**2 + cos(radians(lat1))*cos(radians(lat2))*sin(dlon/2)**2
        return R * 2 * atan2(sqrt(a), sqrt(1-a))

    def generate_transaction(self):
        user = random.choice(self.user_profiles)
        is_fraud = random.random() < self.fraud_rate
        now = datetime.now()

        if is_fraud:
            # Fraud pattern
            merchant_cat = random.choices([3, 4, 5], weights=[0.3, 0.3, 0.4])[0]
            amount = np.random.lognormal(5.5, 1.2)
            hour = random.choices(range(24), weights=[3,4,4,3,2,1,0.5,0.5,0.5,0.5,0.5,0.5,0.5,0.5,0.5,0.5,0.5,0.5,1,1.5,2,2.5,3,3])[0]
            txn_lat = random.uniform(-60, 70)
            txn_lon = random.uniform(-180, 180)
            is_foreign = 1 if random.random() < 0.65 else 0
            card_present = 0 if random.random() < 0.75 else 1
            velocity_1h = int(np.random.poisson(3))
            velocity_24h = int(np.random.poisson(8))
            failed_attempts = int(np.random.poisson(1.5))
            country = random.choice(["RU", "NG", "CN", "UA", "BR"])
        else:
            merchant_cat = random.choices([0,1,2,3,4,5], weights=[30,25,20,10,10,5])[0]
            amount = np.random.lognormal(4.0, 1.0)
            hour = now.hour
            txn_lat = user["home_lat"] + random.gauss(0, 0.5)
            txn_lon = user["home_lon"] + random.gauss(0, 0.5)
            is_foreign = 1 if random.random() < 0.08 else 0
            card_present = 1 if random.random() < 0.8 else 0
            velocity_1h = int(np.random.poisson(0.5))
            velocity_24h = int(np.random.poisson(3))
            failed_attempts = int(np.random.poisson(0.1))
            country = "US" if not is_foreign else random.choice(["UK", "CA", "DE", "FR"])

        distance = self._haversine_km(user["home_lat"], user["home_lon"], txn_lat, txn_lon)
        merchant_names = MERCHANT_NAMES[merchant_cat]

        return {
            "transaction_id": str(uuid.uuid4()),
            "user_id": user["user_id"],
            "timestamp": now.isoformat(),
            "amount": round(amount, 2),
            "currency": "USD",
            "merchant_name": random.choice(merchant_names),
            "merchant_category": merchant_cat,
            "country": country,
            "card_network": user["card_network"],
            "card_present": card_present,
            "is_foreign": is_foreign,
            # ML features
            "features": {
                "amount": round(amount, 2),
                "hour_of_day": hour,
                "day_of_week": now.weekday(),
                "merchant_category": merchant_cat,
                "distance_from_home": round(distance, 2),
                "transaction_velocity_1h": velocity_1h,
                "transaction_velocity_24h": velocity_24h,
                "avg_amount_30d": round(user["avg_amount"], 2),
                "amount_deviation": round((amount - user["avg_amount"]) / (user["avg_amount"] + 1), 4),
                "is_foreign": is_foreign,
                "card_present": card_present,
                "recurring": 0,
                "high_risk_merchant": 1 if merchant_cat >= 3 else 0,
                "account_age_days": round(user["account_age_days"], 0),
                "failed_attempts_24h": failed_attempts,
            },
            "_ground_truth": is_fraud,  # for evaluation only
        }

    def stream(self, interval_ms=500):
        """Generator simulating Kafka consumer poll loop."""
        while True:
            yield self.generate_transaction()
            time.sleep(interval_ms / 1000)
