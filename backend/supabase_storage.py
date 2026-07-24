import os
import uuid
import httpx
from typing import Optional

ALLOWED_MIME_TYPES = {
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
    "image/webp": "webp"
}

MAX_AVATAR_SIZE_BYTES = 5 * 1024 * 1024  # 5 MB limit

def get_supabase_config():
    supabase_url = os.getenv("SUPABASE_URL", "").rstrip("/")
    service_key = (
        os.getenv("SUPABASE_SERVICE_ROLE_KEY", "") or
        os.getenv("SUPABASE_KEY", "") or
        os.getenv("SUPABASE_ANON_KEY", "")
    ).strip()
    bucket = os.getenv("SUPABASE_AVATAR_BUCKET", "avatars").strip()
    return supabase_url, service_key, bucket


def upload_avatar_to_supabase(file_bytes: bytes, content_type: str, filename_hint: str = "avatar.png") -> str:
    """
    Uploads an avatar file to Supabase Storage bucket and returns its public URL.
    Raises ValueError on validation failure, or RuntimeError on network/Supabase errors.
    """
    if not file_bytes:
        raise ValueError("Uploaded file is empty.")

    if len(file_bytes) > MAX_AVATAR_SIZE_BYTES:
        raise ValueError("Avatar file size exceeds maximum limit of 5MB.")

    content_type_clean = (content_type or "").lower().split(";")[0].strip()
    if content_type_clean not in ALLOWED_MIME_TYPES:
        ext_hint = filename_hint.split(".")[-1].lower() if "." in filename_hint else ""
        if content_type_clean in ("", "application/octet-stream") and ext_hint in ("jpg", "jpeg", "png", "webp"):
            if ext_hint in ("jpg", "jpeg"):
                content_type_clean = "image/jpeg"
            elif ext_hint == "png":
                content_type_clean = "image/png"
            elif ext_hint == "webp":
                content_type_clean = "image/webp"
        else:
            raise ValueError(f"Unsupported image type: '{content_type}'. Allowed types: JPEG, PNG, WebP.")

    ext = ALLOWED_MIME_TYPES[content_type_clean]
    unique_filename = f"{uuid.uuid4().hex}.{ext}"

    supabase_url, service_key, bucket = get_supabase_config()
    if not supabase_url or not service_key:
        raise RuntimeError("Supabase credentials (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY) are not configured.")

    endpoint_url = f"{supabase_url}/storage/v1/object/{bucket}/{unique_filename}"
    
    # Primary headers sending both apikey and Bearer authorization
    headers = {
        "apikey": service_key,
        "Authorization": f"Bearer {service_key}",
        "Content-Type": content_type_clean,
        "x-upsert": "true"
    }

    try:
        response = httpx.post(endpoint_url, headers=headers, content=file_bytes, timeout=10.0)
        
        # If Kong returns Invalid Compact JWS (occurs with non-JWT secret keys), retry with apikey header only
        if response.status_code in (400, 401, 403) and "Invalid Compact JWS" in response.text:
            headers_fallback = {
                "apikey": service_key,
                "Content-Type": content_type_clean,
                "x-upsert": "true"
            }
            response = httpx.post(endpoint_url, headers=headers_fallback, content=file_bytes, timeout=10.0)

    except Exception as e:
        raise RuntimeError(f"Failed to connect to Supabase Storage: {str(e)}")

    if response.status_code not in (200, 201):
        raise RuntimeError(f"Supabase Storage upload error ({response.status_code}): {response.text}")

    public_url = f"{supabase_url}/storage/v1/object/public/{bucket}/{unique_filename}"
    return public_url


def delete_avatar_from_supabase(avatar_url: Optional[str]) -> bool:
    """
    Deletes an avatar object from Supabase Storage if the URL matches our Supabase bucket.
    Returns True if deleted, False otherwise. Does not raise exceptions.
    """
    if not avatar_url:
        return False

    supabase_url, service_key, bucket = get_supabase_config()
    if not supabase_url or not service_key:
        return False

    public_prefix = f"{supabase_url}/storage/v1/object/public/{bucket}/"
    if not avatar_url.startswith(public_prefix):
        return False

    filename = avatar_url[len(public_prefix):]
    if not filename:
        return False

    endpoint_url = f"{supabase_url}/storage/v1/object/{bucket}"
    headers = {
        "apikey": service_key,
        "Authorization": f"Bearer {service_key}",
        "Content-Type": "application/json"
    }
    payload = {"prefixes": [filename]}

    try:
        response = httpx.request("DELETE", endpoint_url, headers=headers, json=payload, timeout=5.0)
        if response.status_code in (400, 401, 403) and "Invalid Compact JWS" in response.text:
            headers_fallback = {
                "apikey": service_key,
                "Content-Type": "application/json"
            }
            response = httpx.request("DELETE", endpoint_url, headers=headers_fallback, json=payload, timeout=5.0)
        return response.status_code in (200, 204)
    except Exception as e:
        print(f"Non-critical: Failed to delete old avatar from Supabase Storage: {e}")
        return False
