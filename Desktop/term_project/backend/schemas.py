from pydantic import BaseModel
from typing import Optional

class CommentSchema(BaseModel):
    comment_id: str
    post_id: str
    author: str
    content: str

class MLPredictionResponse(BaseModel):
    model_name: str
    prediction: int
    probability: Optional[float] = None