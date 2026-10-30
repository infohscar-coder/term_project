import streamlit as st
import requests
import pandas as pd


BACKEND_URL = "https://term-project-hwm8.onrender.com"

st.set_page_config(page_title="AI & Data Analysis Integrated Web Service", layout="wide")
st.title("🤖 AI & Data Analysis Integrated Web Service")

# Sidebar Navigation
module = st.sidebar.selectbox(
    "Select AI Module",
    [
        "1. Gemini Auto-Reply Webhook",
        "2. Titanic ML Benchmark & EDA",
        "3. ResNet-18 Image Classification",
        "4. YOLOv8 Object Detection",
        "5. RAG Document Q&A"
    ]
)

# --- Module 1: Gemini Auto-Reply ---
if module == "1. Gemini Auto-Reply Webhook":
    st.header("💬 Gemini Auto-Reply Webhook")
    st.markdown("Simulate incoming comments or inquiries and generate AI automated replies.")
    user_comment = st.text_area("Enter user comment/inquiry:")
    if st.button("Generate Auto-Reply"):
        if user_comment:
            try:
                res = requests.post(f"{BACKEND_URL}/api/gemini/reply", json={"comment": user_comment})
                if res.status_code == 200:
                    st.success("AI Reply Generated:")
                    st.write(res.json().get("reply"))
                else:
                    st.error("Backend error generating reply.")
            except Exception as e:
                st.error(f"Connection error: {e}")
        else:
            st.warning("Please enter a comment.")

# --- Module 2: Titanic ML Benchmark ---
elif module == "2. Titanic ML Benchmark & EDA":
    st.header("📊 Titanic Machine Learning Benchmark")
    st.markdown("Compare performance metrics (**Recall, F1-Score, AUROC, PRAUC**) across 6 machine learning models.")
    
    if st.button("Run Benchmark & Evaluate Models"):
        with st.spinner("Training models and calculating metrics..."):
            try:
                res = requests.get(f"{BACKEND_URL}/api/titanic/benchmark")
                if res.status_code == 200:
                    metrics_df = pd.DataFrame(res.json())
                    st.success("Benchmark Completed Successfully!")
                    st.dataframe(metrics_df.style.highlight_max(axis=0, color='lightgreen'))
                    st.subheader("📈 Metric Comparison Chart")
                    st.bar_chart(metrics_df)
                else:
                    st.error("Failed to run benchmark from backend.")
            except Exception as e:
                st.error(f"Error connecting to backend: {e}")

# --- Module 3: ResNet-18 Image Classification ---
elif module == "3. ResNet-18 Image Classification":
    st.header("🖼️ ResNet-18 Image Classification (Cat vs. Dog)")
    uploaded_file = st.file_uploader("Upload an image (Cat or Dog)...", type=["jpg", "jpeg", "png"])
    
    if uploaded_file is not None:
        st.image(uploaded_file, caption="Uploaded Image", use_column_width=True)
        if st.button("Classify Image"):
            with st.spinner("Classifying image via backend PyTorch model..."):
                try:
                    # Send image file to Render backend
                    files = {"file": (uploaded_file.name, uploaded_file.getvalue(), uploaded_file.type)}
                    response = requests.post(f"{BACKEND_URL}/api/classify", files=files)
                    
                    if response.status_code == 200:
                        result = response.json()
                        st.success(f"Prediction Result: {result}")
                    else:
                        st.error("Failed to classify image from backend.")
                except Exception as e:
                    st.error(f"Error connecting to backend: {e}")

# --- Module 4: YOLOv8 Object Detection ---
elif module == "4. YOLOv8 Object Detection":
    st.header("🔍 YOLOv8 Object Detection")
    yolo_file = st.file_uploader("Upload an image with multiple objects...", type=["jpg", "jpeg", "png"])
    if yolo_file is not None:
        st.image(yolo_file, caption="Uploaded Image for Detection", use_column_width=True)
        if st.button("Run Object Detection"):
            with st.spinner("Running YOLOv8 inference on backend..."):
                try:
                    files = {"file": (yolo_file.name, yolo_file.getvalue(), yolo_file.type)}
                    response = requests.post(f"{BACKEND_URL}/api/yolo", files=files)
                    
                    if response.status_code == 200:
                        # Assuming your backend returns an annotated image or JSON
                        st.success("Object detection completed successfully!")
                        st.json(response.json()) # Or st.image() if your backend returns an image bytes
                    else:
                        st.error("Failed to run object detection from backend.")
                except Exception as e:
                    st.error(f"Error connecting to backend: {e}")

# --- Module 5: RAG Document Q&A ---
elif module == "5. RAG Document Q&A":
    st.header("📚 RAG Document Q&A")
    doc_file = st.file_uploader("Upload reference document (TXT/PDF)...", type=["txt", "pdf"])
    question = st.text_input("Ask a question about the document:")
    
    if st.button("Get AI Answer"):
        if doc_file is not None and question:
            with st.spinner("Processing vector search and Gemini generation..."):
                try:
                    files = {"file": (doc_file.name, doc_file.getvalue(), doc_file.type)}
                    data = {"question": question}
                    response = requests.post(f"{BACKEND_URL}/api/rag", files=files, data=data)
                    
                    if response.status_code == 200:
                        result = response.json()
                        st.success("AI Answer:")
                        st.write(result.get("answer", result))
                    else:
                        st.error("Failed to get answer from backend.")
                except Exception as e:
                    st.error(f"Error connecting to backend: {e}")
        else:
            st.warning("Please upload a document and enter a question.")