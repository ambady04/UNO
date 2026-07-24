import pytest
from unittest.mock import patch, MagicMock
from supabase_storage import upload_avatar_to_supabase, delete_avatar_from_supabase

def test_upload_avatar_empty():
    with pytest.raises(ValueError, match="file is empty"):
        upload_avatar_to_supabase(b"", "image/png")

def test_upload_avatar_oversized():
    huge_bytes = b"x" * (5 * 1024 * 1024 + 1)
    with pytest.raises(ValueError, match="exceeds maximum limit"):
        upload_avatar_to_supabase(huge_bytes, "image/png")

def test_upload_avatar_invalid_mime():
    with pytest.raises(ValueError, match="Unsupported image type"):
        upload_avatar_to_supabase(b"fakecontent", "application/pdf")

@patch("supabase_storage.get_supabase_config")
@patch("httpx.post")
def test_upload_avatar_success(mock_post, mock_config):
    mock_config.return_value = ("https://testref.supabase.co", "testkey", "avatars")
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_post.return_value = mock_response

    url = upload_avatar_to_supabase(b"imagebytes", "image/png", "test.png")
    assert url.startswith("https://testref.supabase.co/storage/v1/object/public/avatars/")
    assert url.endswith(".png")

@patch("supabase_storage.get_supabase_config")
@patch("httpx.request")
def test_delete_avatar_success(mock_req, mock_config):
    mock_config.return_value = ("https://testref.supabase.co", "testkey", "avatars")
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_req.return_value = mock_response

    target_url = "https://testref.supabase.co/storage/v1/object/public/avatars/old_avatar.png"
    result = delete_avatar_from_supabase(target_url)
    assert result is True

def test_delete_avatar_external_url_ignored():
    external_url = "https://lh3.googleusercontent.com/a/default-user"
    result = delete_avatar_from_supabase(external_url)
    assert result is False
