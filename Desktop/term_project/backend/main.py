import pandas as pd
import numpy as np
from fastapi import FastAPI, HTTPException
import google.generativeai as genai
import os
from dotenv import load_dotenv
from backend.schemas import CommentSchema
from backend.storage import save_comment, get_all_comments

from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler
from sklearn.impute import SimpleImputer
from sklearn.neighbors import KNeighborsClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.naive_bayes import GaussianNB
from sklearn.tree import DecisionTreeClassifier
from sklearn.ensemble import RandomForestClassifier
from xgboost import XGBClassifier
from sklearn.metrics import recall_score, f1_score, roc_auc_score, precision_recall_curve, auc

load_dotenv()
genai.configure(api_key=os.getenv("GEMINI_API_KEY"))

app = FastAPI(title="AI Model Management Term Project API")

@app.get("/")
def read_root():
    return {"message": "FastAPI Backend is running successfully!"}

# --- Module 1: Gemini Auto-Reply Webhook ---
@app.post("/webhook/comment")
async def handle_comment(data: CommentSchema):
    try:
        model = genai.GenerativeModel('gemini-1.5-flash')
        response = model.generate_content(f"Write a helpful and polite reply to this customer comment: {data.content}")
        ai_reply = response.text
    except Exception as e:
        ai_reply = f"Automated Reply: Thank you for your feedback! We are processing your request. (Error details: {str(e)})"

    result = {
        "accepted": True,
        "comment_id": data.comment_id,
        "post_id": data.post_id,
        "author": data.author,
        "content": data.content,
        "status": "processed",
        "ai_reply": ai_reply
    }
    
    save_comment(result)
    return result

@app.get("/comments")
def list_comments():
    return get_all_comments()


# --- Module 2: Titanic ML Benchmark Helpers & Endpoint ---
TITANIC_URL = "https://raw.githubusercontent.com/wesm/pydata-book/3rd-edition/datasets/titanic/train.csv"

def prepare_titanic_data():
    df = pd.read_csv(TITANIC_URL)
    features = ['Pclass', 'Sex', 'Age', 'SibSp', 'Parch', 'Fare', 'Embarked']
    X = df[features].copy()
    y = df['Survived']
    
    X['Sex'] = X['Sex'].map({'male': 0, 'female': 1})
    X = pd.get_dummies(X, columns=['Embarked'], drop_first=True)
    
    imputer = SimpleImputer(strategy='median')
    X_imputed = imputer.fit_transform(X)
    
    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X_imputed)
    
    return X_scaled, y

def evaluate_models(X, y):
    X_train, X_val, y_train, y_val = train_test_split(X, y, test_size=0.2, random_state=42, stratify=y)
    
    models = {
        "KNN": KNeighborsClassifier(),
        "Logistic Regression": LogisticRegression(max_iter=1000),
        "Naive Bayes": GaussianNB(),
        "Decision Tree": DecisionTreeClassifier(random_state=42),
        "Random Forest": RandomForestClassifier(random_state=42),
        "XGBoost": XGBClassifier(use_label_encoder=False, eval_metric='logloss', random_state=42)
    }
    
    results = {}
    for name, model in models.items():
        model.fit(X_train, y_train)
        y_pred = model.predict(X_val)
        y_prob = model.predict_proba(X_val)[:, 1] if hasattr(model, "predict_proba") else y_pred
        
        rec = recall_score(y_val, y_pred)
        f1 = f1_score(y_val, y_pred)
        auroc = roc_auc_score(y_val, y_prob)
        
        precision_vals, recall_vals, _ = precision_recall_curve(y_val, y_prob)
        prauc = auc(recall_vals, precision_vals)
        
        results[name] = {
            "Recall": round(float(rec), 4),
            "F1-Score": round(float(f1), 4),
            "AUROC": round(float(auroc), 4),
            "PRAUC": round(float(prauc), 4)
        }
        
    return results

@app.get("/api/titanic/benchmark")
async def titanic_benchmark():
    try:
        X, y = prepare_titanic_data()
        results = evaluate_models(X, y)
        return results
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))