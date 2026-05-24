"""
Train fraud detection model using GradientBoosting.
Produces: models/fraud_model.pkl, models/feature_info.json
"""
import numpy as np
import pandas as pd
import pickle
import json
import os
from sklearn.ensemble import GradientBoostingClassifier
from sklearn.preprocessing import StandardScaler
from sklearn.model_selection import train_test_split
from sklearn.metrics import classification_report, roc_auc_score

np.random.seed(42)

FEATURES = [
    "amount", "hour_of_day", "day_of_week",
    "merchant_category", "distance_from_home",
    "transaction_velocity_1h", "transaction_velocity_24h",
    "avg_amount_30d", "amount_deviation", "is_foreign",
    "card_present", "recurring", "high_risk_merchant",
    "account_age_days", "failed_attempts_24h",
]

def generate_dataset(n=50000):
    """Synthetic transaction data with realistic fraud patterns."""
    # Legitimate transactions
    n_legit = int(n * 0.97)
    n_fraud = n - n_legit

    legit = pd.DataFrame({
        "amount": np.random.lognormal(4.0, 1.0, n_legit),
        "hour_of_day": np.random.choice(range(24), n_legit, p=(lambda a: a/a.sum())(np.array([0.5,0.4,0.3,0.2,0.1,0.1,0.2,0.8,1.5,2.0,2.2,2.3,2.3,2.2,2.1,2.0,1.9,1.8,1.7,1.6,1.4,1.2,1.0,0.7]))),
        "day_of_week": np.random.randint(0, 7, n_legit),
        "merchant_category": np.random.choice([0,1,2,3,4,5], n_legit, p=[0.3,0.25,0.2,0.1,0.1,0.05]),
        "distance_from_home": np.random.exponential(15, n_legit),
        "transaction_velocity_1h": np.random.poisson(0.5, n_legit),
        "transaction_velocity_24h": np.random.poisson(3, n_legit),
        "avg_amount_30d": np.random.lognormal(3.8, 0.8, n_legit),
        "is_foreign": np.random.choice([0, 1], n_legit, p=[0.92, 0.08]),
        "card_present": np.random.choice([0, 1], n_legit, p=[0.2, 0.8]),
        "recurring": np.random.choice([0, 1], n_legit, p=[0.7, 0.3]),
        "high_risk_merchant": np.random.choice([0, 1], n_legit, p=[0.95, 0.05]),
        "account_age_days": np.random.gamma(5, 200, n_legit),
        "failed_attempts_24h": np.random.poisson(0.1, n_legit),
        "label": 0
    })

    # Fraud patterns: late night, high amount, foreign, low account age
    fraud = pd.DataFrame({
        "amount": np.random.lognormal(5.5, 1.5, n_fraud),
        "hour_of_day": np.random.choice(range(24), n_fraud, p=(lambda a: a/a.sum())(np.array([3.0,3.5,3.5,3.0,2.0,1.0,0.5,0.5,0.5,0.5,0.5,0.5,0.5,0.5,0.5,0.5,0.5,0.5,1.0,1.5,2.0,2.5,3.0,3.0]))),
        "day_of_week": np.random.randint(0, 7, n_fraud),
        "merchant_category": np.random.choice([0,1,2,3,4,5], n_fraud, p=[0.1,0.1,0.1,0.2,0.2,0.3]),
        "distance_from_home": np.random.exponential(200, n_fraud),
        "transaction_velocity_1h": np.random.poisson(3, n_fraud),
        "transaction_velocity_24h": np.random.poisson(8, n_fraud),
        "avg_amount_30d": np.random.lognormal(3.5, 0.8, n_fraud),
        "is_foreign": np.random.choice([0, 1], n_fraud, p=[0.35, 0.65]),
        "card_present": np.random.choice([0, 1], n_fraud, p=[0.75, 0.25]),
        "recurring": np.random.choice([0, 1], n_fraud, p=[0.95, 0.05]),
        "high_risk_merchant": np.random.choice([0, 1], n_fraud, p=[0.4, 0.6]),
        "account_age_days": np.random.gamma(1.5, 60, n_fraud),
        "failed_attempts_24h": np.random.poisson(1.5, n_fraud),
        "label": 1
    })

    df = pd.concat([legit, fraud]).sample(frac=1).reset_index(drop=True)
    # Derived feature
    df["amount_deviation"] = (df["amount"] - df["avg_amount_30d"]) / (df["avg_amount_30d"] + 1)
    return df

def compute_shap_values(model, X, feature_names, n_bg=200):
    """
    TreeSHAP approximation via interventional permutation.
    Returns array (n_samples, n_features) of SHAP values for fraud class.
    """
    bg = X[:n_bg]
    baseline = model.predict_proba(bg)[:, 1].mean()
    shap_vals = np.zeros_like(X, dtype=float)

    for i in range(len(X)):
        row = X[i:i+1]
        for j in range(X.shape[1]):
            # Marginal contribution: feature present vs absent (replaced by bg distribution)
            with_feat = np.tile(row, (n_bg, 1))
            without_feat = bg.copy()
            without_feat[:, j] = row[0, j]

            p_with = model.predict_proba(without_feat)[:, 1].mean()
            p_without = model.predict_proba(bg)[:, 1].mean()
            shap_vals[i, j] = p_with - p_without

    return shap_vals

def train():
    print("Generating dataset...")
    df = generate_dataset(50000)

    X = df[FEATURES].values
    y = df["label"].values

    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, stratify=y)

    scaler = StandardScaler()
    X_train_s = scaler.fit_transform(X_train)
    X_test_s = scaler.transform(X_test)

    print("Training GradientBoostingClassifier...")
    model = GradientBoostingClassifier(
        n_estimators=200,
        max_depth=5,
        learning_rate=0.1,
        subsample=0.8,
        min_samples_leaf=20,
        random_state=42,
        verbose=1
    )
    model.fit(X_train_s, y_train)

    y_pred = model.predict(X_test_s)
    y_prob = model.predict_proba(X_test_s)[:, 1]
    auc = roc_auc_score(y_test, y_prob)

    print(f"\nAUC-ROC: {auc:.4f}")
    print(classification_report(y_test, y_pred))

    os.makedirs("models", exist_ok=True)

    with open("models/fraud_model.pkl", "wb") as f:
        pickle.dump({"model": model, "scaler": scaler}, f)

    # Feature importances from tree (fast, deterministic)
    importances = model.feature_importances_.tolist()

    feature_info = {
        "features": FEATURES,
        "importances": importances,
        "auc": auc,
        "threshold": 0.5,
        "feature_descriptions": {
            "amount": "Transaction amount (USD)",
            "hour_of_day": "Hour of transaction (0-23)",
            "day_of_week": "Day of week (0=Mon)",
            "merchant_category": "MCC code category (0-5)",
            "distance_from_home": "Distance from home address (km)",
            "transaction_velocity_1h": "Transactions in last 1 hour",
            "transaction_velocity_24h": "Transactions in last 24 hours",
            "avg_amount_30d": "Average spend last 30 days",
            "amount_deviation": "Deviation from 30-day average",
            "is_foreign": "Foreign transaction (0/1)",
            "card_present": "Physical card present (0/1)",
            "recurring": "Recurring merchant (0/1)",
            "high_risk_merchant": "High-risk merchant category (0/1)",
            "account_age_days": "Account age in days",
            "failed_attempts_24h": "Failed auth attempts in 24h",
        }
    }

    with open("models/feature_info.json", "w") as f:
        json.dump(feature_info, f, indent=2)

    print("\nModel saved to models/fraud_model.pkl")
    print("Feature info saved to models/feature_info.json")
    return auc

if __name__ == "__main__":
    train()
