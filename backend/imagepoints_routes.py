# ─────────────────────────────────────────────────────────────
# ADD THIS IMPORT to the top of app.py
# ─────────────────────────────────────────────────────────────
#
#   from auth.imagepoints import ImagePointsAuth
#
# ─────────────────────────────────────────────────────────────
# PASTE THESE ROUTES into app.py (before the if __name__ block)
# ─────────────────────────────────────────────────────────────

import base64 as _base64


# Built-in image set — stored in backend/static/images/
# User can also upload their own
BUILTIN_IMAGES = [
    "city.jpg",
    "nature.jpg",
    "room.jpg",
    "map.jpg",
    "abstract.jpg",
]


@app.route("/imagepoints/images", methods=["GET"])
def list_images():
    """
    Returns list of built-in images available for selection.
    """
    images = []

    static_dir = os.path.join(os.path.dirname(__file__), "static", "images")

    for filename in BUILTIN_IMAGES:
        path = os.path.join(static_dir, filename)
        if os.path.exists(path):
            images.append({
                "id":  filename,
                "url": f"https://127.0.0.1:5000/static/images/{filename}"
            })

    return jsonify({"images": images})


@app.route("/imagepoints/upload-image", methods=["POST"])
def upload_image():
    """
    User uploads their own image to use for point authentication.
    Saves it to backend/static/images/user_<username>_<token>.jpg
    Returns the image_id to use in setup.
    """
    token   = request.headers.get("Authorization")
    session = SessionManager.validate(token)

    if not session:
        return jsonify({"error": "Invalid session"}), 401

    if "image" not in request.files:
        return jsonify({"error": "No image provided"}), 400

    img_file  = request.files["image"]
    ext       = os.path.splitext(img_file.filename)[1].lower()

    if ext not in [".jpg", ".jpeg", ".png", ".webp"]:
        return jsonify({"error": "Unsupported image format"}), 400

    image_id  = f"user_{session['username']}_{secrets.token_hex(8)}{ext}"
    save_dir  = os.path.join(os.path.dirname(__file__), "static", "images")
    os.makedirs(save_dir, exist_ok=True)
    img_file.save(os.path.join(save_dir, image_id))

    return jsonify({
        "image_id": image_id,
        "url": f"https://127.0.0.1:5000/static/images/{image_id}"
    })


@app.route("/imagepoints/setup", methods=["POST"])
def imagepoints_setup():
    """
    Registers image point authentication for a user.

    Body:
    {
        "points":    [{"x": 0.45, "y": 0.32}, ...],   // percentages
        "image_id":  "city.jpg",
        "tolerance": 0.05                               // 5% of image width
    }
    """
    token   = request.headers.get("Authorization")
    session = SessionManager.validate(token)

    if not session:
        return jsonify({"error": "Invalid session"}), 401

    data      = request.json
    points    = data.get("points", [])
    image_id  = data.get("image_id")
    tolerance = float(data.get("tolerance", 0.05))

    if not image_id:
        return jsonify({"error": "image_id required"}), 400

    if len(points) < 2:
        return jsonify({"error": "At least 2 points required"}), 400

    if tolerance < 0.01 or tolerance > 0.20:
        return jsonify({"error": "Tolerance must be between 0.01 and 0.20"}), 400

    from security.crypto_utils import decrypt_with_key, encrypt_with_key

    master_key = decrypt_with_key(
        session["session_key"],
        session["encrypted_master"]
    )

    user_dir = os.path.join(BASE_USERS_DIR, session["username"])
    meta_dir = os.path.join(user_dir, "meta")

    ip = ImagePointsAuth(meta_dir)

    try:
        unlock_token = ip.setup(points, image_id, tolerance)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400

    # Save encrypted master key for this method
    encrypted_master_ip = encrypt_with_key(unlock_token, master_key)
    open(os.path.join(meta_dir, "master.imagepoints.enc"), "wb").write(encrypted_master_ip)

    # Update policy to include imagepoints and store image metadata for login page
    from policy.manager import PolicyManager
    policy_manager = PolicyManager(user_dir)
    try:
        policy = policy_manager.load_policy(master_key)
        if "imagepoints" not in policy["enabled"]:
            policy["enabled"].append("imagepoints")
        # Store image_id and point count so login page knows what to show
        policy["imagepoints_image_id"]    = image_id
        policy["imagepoints_point_count"] = len(points)
        from security.crypto_utils import encrypt_with_key
        open(policy_manager.policy_file, "wb").write(
            encrypt_with_key(master_key, json.dumps(policy).encode())
        )
    except Exception as e:
        print("Policy update error:", e)

    # Write public metadata so login page knows which image and point count to show
    public_meta_path = os.path.join(meta_dir, "public_meta.json")
    try:
        pub = json.load(open(public_meta_path)) if os.path.exists(public_meta_path) else {}
    except:
        pub = {}
    pub["imagepoints_image_id"]    = image_id
    pub["imagepoints_point_count"] = len(points)
    json.dump(pub, open(public_meta_path, "w"))

    log_event(session["username"], "IMAGEPOINTS_SETUP", "SUCCESS")
    return jsonify({"message": "Image points profile saved"})


@app.route("/imagepoints/verify", methods=["POST"])
def imagepoints_verify():
    """
    Verifies image point authentication during login.
    This is called as part of the login flow — returns an unlock token
    that the login route can use to decrypt the master key.

    Body:
    {
        "username":  "alice",
        "points":    [{"x": 0.45, "y": 0.32}, ...],
        "image_id":  "city.jpg"
    }
    """
    data      = request.json
    username  = data.get("username")
    points    = data.get("points", [])
    image_id  = data.get("image_id")

    if not username or not image_id or not points:
        return jsonify({"error": "username, points and image_id required"}), 400

    user_dir = os.path.join(BASE_USERS_DIR, username)
    meta_dir = os.path.join(user_dir, "meta")

    if not os.path.exists(meta_dir):
        return jsonify({"error": "User not found"}), 404

    ip = ImagePointsAuth(meta_dir)
    ok, result = ip.verify(points, image_id)

    if ok:
        # Return unlock token as hex — login flow uses this to decrypt master key
        return jsonify({
            "success":       True,
            "unlock_token":  result.hex()
        })
    else:
        return jsonify({"success": False, "error": result}), 401