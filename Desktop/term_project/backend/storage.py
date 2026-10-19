# Simple in-memory storage for comments and webhook outputs
comments_db = []

def save_comment(comment_data: dict):
    comments_db.append(comment_data)
    return comment_data

def get_all_comments():
    return comments_db