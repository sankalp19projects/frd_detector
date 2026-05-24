"""
Fraud detection inference engine.
- Loads trained model
- Scores transactions
- Computes feature attributions (SHAP-style via marginal contribution)
"""
import numpy as np
import pickle
import json
import os
from typing import Dict, Any, List, Tuple

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

class FraudDetector:
    def __init__(self, threshold: float = 0.5):
        self.threshold = threshold
        self._load_model()
        self._load_feature_info()
        # Background samples for SHAP baseline (estimated from training distribution)
        self._init_background()

    def _load_model(self):
        model_path = os.path.join(BASE_DIR, "models", "fraud_model.pkl")
        with open(model_path, "rb") as f:
            artifacts = pickle.load(f)
        self.model = artifacts["model"]
        self.scaler = artifacts["scaler"]

    def _load_feature_info(self):
        info_path = os.path.join(BASE_DIR, "models", "feature_info.json")
        with open(info_path, "r") as f:
            self.feature_info = json.load(f)
        self.feature_names = self.feature_info["features"]
        self.feature_importances = dict(zip(
            self.feature_names,
            self.feature_info["importances"]
        ))

    def _init_background(self):
        """
        Pre-computed background distribution (mean feature values by class).
        Used as baseline for SHAP attribution.
        In production: store actual training samples.
        """
        # Approximate means from training distribution
        self.bg_mean = np.array([
            80.0,   # amount
            14.0,   # hour_of_day
            2.5,    # day_of_week
            1.2,    # merchant_category
            18.0,   # distance_from_home
            0.5,    # transaction_velocity_1h
            3.0,    # transaction_velocity_24h
            75.0,   # avg_amount_30d
            0.05,   # amount_deviation
            0.08,   # is_foreign
            0.8,    # card_present
            0.3,    # recurring
            0.05,   # high_risk_merchant
            800.0,  # account_age_days
            0.1,    # failed_attempts_24h
        ])

    def _features_to_array(self, features: Dict) -> np.ndarray:
        return np.array([features[f] for f in self.feature_names]).reshape(1, -1)

    def compute_shap(self, feature_array: np.ndarray) -> Dict[str, float]:
        """
        Compute marginal SHAP contributions for each feature.
        For each feature j:
          phi_j = E[f(x) | x_j=val] - E[f(x) | x_j=bg_mean_j]
        This is the interventional SHAP approximation.
        """
        x = feature_array[0].copy()
        baseline = self.bg_mean.copy()

        # Baseline prediction (all features at background)
        bg_scaled = self.scaler.transform(baseline.reshape(1, -1))
        p_baseline = self.model.predict_proba(bg_scaled)[0, 1]

        # Full prediction
        x_scaled = self.scaler.transform(x.reshape(1, -1))
        p_full = self.model.predict_proba(x_scaled)[0, 1]

        shap_values = {}
        for j, fname in enumerate(self.feature_names):
            # Intervention: replace feature j with actual value, rest at baseline
            intervention = baseline.copy()
            intervention[j] = x[j]
            intervention_scaled = self.scaler.transform(intervention.reshape(1, -1))
            p_intervention = self.model.predict_proba(intervention_scaled)[0, 1]
            shap_values[fname] = round(float(p_intervention - p_baseline), 5)

        return shap_values, round(float(p_baseline), 4), round(float(p_full), 4)

    def score(self, transaction: Dict[str, Any]) -> Dict[str, Any]:
        """Score a single transaction, return enriched result with explainability."""
        features = transaction["features"]
        x = self._features_to_array(features)
        x_scaled = self.scaler.transform(x)

        fraud_prob = float(self.model.predict_proba(x_scaled)[0, 1])
        is_fraud = fraud_prob >= self.threshold

        # SHAP attributions
        shap_values, p_baseline, p_full = self.compute_shap(x)

        # Sort features by absolute SHAP impact
        top_factors = sorted(
            [{"feature": k, "shap": v, "value": features[k], "importance": self.feature_importances[k]}
             for k, v in shap_values.items()],
            key=lambda r: abs(r["shap"]),
            reverse=True
        )[:7]

        # Risk level
        if fraud_prob >= 0.85:
            risk_level = "CRITICAL"
        elif fraud_prob >= 0.65:
            risk_level = "HIGH"
        elif fraud_prob >= 0.40:
            risk_level = "MEDIUM"
        else:
            risk_level = "LOW"

        return {
            **transaction,
            "fraud_probability": round(fraud_prob, 4),
            "is_fraud": is_fraud,
            "risk_level": risk_level,
            "shap_baseline": p_baseline,
            "shap_full": p_full,
            "top_factors": top_factors,
            "all_shap": shap_values,
            "model_features": features,
        }

    def batch_score(self, transactions: List[Dict]) -> List[Dict]:
        return [self.score(t) for t in transactions]
