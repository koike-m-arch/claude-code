"""Google OAuth認証セットアップスクリプト（workspace-mcp用）"""
import json
import os
from google_auth_oauthlib.flow import InstalledAppFlow

from _credentials import GOOGLE_CLIENT_ID as CLIENT_ID, GOOGLE_CLIENT_SECRET as CLIENT_SECRET

SCOPES = [
    "openid",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/userinfo.profile",
    "https://www.googleapis.com/auth/drive",
    "https://www.googleapis.com/auth/drive.readonly",
    "https://www.googleapis.com/auth/drive.file",
    "https://www.googleapis.com/auth/calendar",
    "https://www.googleapis.com/auth/calendar.readonly",
    "https://www.googleapis.com/auth/calendar.events",
    "https://www.googleapis.com/auth/documents",
    "https://www.googleapis.com/auth/documents.readonly",
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/spreadsheets.readonly",
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/gmail.compose",
    "https://www.googleapis.com/auth/gmail.modify",
    "https://www.googleapis.com/auth/gmail.labels",
    "https://www.googleapis.com/auth/gmail.settings.basic",
    "https://www.googleapis.com/auth/presentations",
    "https://www.googleapis.com/auth/presentations.readonly",
    "https://www.googleapis.com/auth/forms.body",
    "https://www.googleapis.com/auth/forms.body.readonly",
    "https://www.googleapis.com/auth/forms.responses.readonly",
    "https://www.googleapis.com/auth/tasks",
    "https://www.googleapis.com/auth/tasks.readonly",
    "https://www.googleapis.com/auth/contacts",
    "https://www.googleapis.com/auth/contacts.readonly",
    "https://www.googleapis.com/auth/chat.messages",
    "https://www.googleapis.com/auth/chat.messages.readonly",
    "https://www.googleapis.com/auth/chat.spaces",
    "https://www.googleapis.com/auth/chat.spaces.readonly",
    "https://www.googleapis.com/auth/cse",
    "https://www.googleapis.com/auth/script.projects",
    "https://www.googleapis.com/auth/script.projects.readonly",
    "https://www.googleapis.com/auth/script.deployments",
    "https://www.googleapis.com/auth/script.deployments.readonly",
    "https://www.googleapis.com/auth/script.processes",
    "https://www.googleapis.com/auth/script.metrics",
]

client_config = {
    "installed": {
        "client_id": CLIENT_ID,
        "client_secret": CLIENT_SECRET,
        "auth_uri": "https://accounts.google.com/o/oauth2/auth",
        "token_uri": "https://oauth2.googleapis.com/token",
        "redirect_uris": ["http://localhost"],
    }
}

flow = InstalledAppFlow.from_client_config(client_config, scopes=SCOPES)
credentials = flow.run_local_server(port=0, prompt="consent", access_type="offline")

cred_data = {
    "token": credentials.token,
    "refresh_token": credentials.refresh_token,
    "token_uri": credentials.token_uri,
    "client_id": credentials.client_id,
    "client_secret": credentials.client_secret,
    "scopes": list(credentials.scopes),
    "expiry": credentials.expiry.isoformat() if credentials.expiry else None,
}

email = "koike-m@mirai-kirei.jp"

cred_dir = os.path.expanduser("~/.google_workspace_mcp/credentials")
os.makedirs(cred_dir, exist_ok=True)
cred_path = os.path.join(cred_dir, f"{email}.json")

with open(cred_path, "w") as f:
    json.dump(cred_data, f, indent=2)

print(f"\n認証成功！ファイル保存先: {cred_path}")
print(f"スコープ数: {len(credentials.scopes)}")
