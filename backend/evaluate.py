"""
Offline evaluation: generates test set, scores with detector, prints full metrics.
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import numpy as np
from sklearn.metrics import (
    classification_report, roc_auc_score, average_precision_score,
    confusion_matrix, roc_curve, precision_recall_curve
)
from backend.detector import FraudDetector
from backend.producer import TransactionProducer

def evaluate(n=2000):
    detector = FraudDetector()
    producer = TransactionProducer(fraud_rate=0.06)

    print(f"Generating {n} test transactions...")
    transactions = [producer.generate_transaction() for _ in range(n)]
    y_true = [int(t["_ground_truth"]) for t in transactions]

    print("Scoring...")
    results = [detector.score(t) for t in transactions]
    y_prob = [r["fraud_probability"] for r in results]
    y_pred = [int(r["is_fraud"]) for r in results]

    # Metrics
    auc = roc_auc_score(y_true, y_prob)
    ap = average_precision_score(y_true, y_prob)
    cm = confusion_matrix(y_true, y_pred)

    print(f"\n{'='*50}")
    print(f"  FRAUD DETECTION EVALUATION RESULTS")
    print(f"{'='*50}")
    print(f"  Test samples : {n}")
    print(f"  True fraud   : {sum(y_true)} ({sum(y_true)/n*100:.1f}%)")
    print(f"  Flagged fraud: {sum(y_pred)}")
    print(f"\n  AUC-ROC      : {auc:.4f}")
    print(f"  Avg Precision: {ap:.4f}")
    print(f"\n  Confusion Matrix:")
    print(f"    TN={cm[0,0]:5d}  FP={cm[0,1]:5d}")
    print(f"    FN={cm[1,0]:5d}  TP={cm[1,1]:5d}")
    print(f"\n  Classification Report:")
    print(classification_report(y_true, y_pred, target_names=["Legit", "Fraud"], digits=4))

    # Threshold sweep
    print("  Threshold Sweep (precision / recall trade-off):")
    print(f"  {'Threshold':>9}  {'Precision':>9}  {'Recall':>9}  {'F1':>9}  {'Flagged':>8}")
    for thr in [0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]:
        yp = [int(p >= thr) for p in y_prob]
        tp = sum(a==1 and b==1 for a,b in zip(y_true,yp))
        fp = sum(a==0 and b==1 for a,b in zip(y_true,yp))
        fn = sum(a==1 and b==0 for a,b in zip(y_true,yp))
        prec = tp/(tp+fp+1e-9)
        rec = tp/(tp+fn+1e-9)
        f1 = 2*prec*rec/(prec+rec+1e-9)
        print(f"  {thr:9.1f}  {prec:9.4f}  {rec:9.4f}  {f1:9.4f}  {sum(yp):8d}")

    # SHAP sanity check
    print("\n  SHAP Attribution check (first 3 fraud transactions):")
    fraud_results = [r for r in results if r["is_fraud"]][:3]
    for r in fraud_results:
        top = r["top_factors"][0]
        print(f"    TXN {r['transaction_id']}: prob={r['fraud_probability']:.3f} | "
              f"top={top['feature']} shap={top['shap']:+.4f} val={top['value']:.2f}")

    return auc

if __name__ == "__main__":
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 2000
    evaluate(n)
