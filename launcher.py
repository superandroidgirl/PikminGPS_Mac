"""PikminGPS Web — .app launcher.

Runs the Flask/SocketIO server in a background thread and opens the
default browser. When bundled by PyInstaller, working dir is set so that
templates/, static/, and favorites.json resolve next to the executable.
"""
import os
import sys
import threading
import time
import webbrowser


def resource_dir():
    if getattr(sys, "frozen", False):
        meipass = getattr(sys, "_MEIPASS", None)
        if meipass and os.path.exists(os.path.join(meipass, "templates")):
            return meipass
        # macOS .app bundle: data lives in Contents/Resources, executable in Contents/MacOS
        return os.path.normpath(
            os.path.join(os.path.dirname(sys.executable), "..", "Resources")
        )
    return os.path.dirname(os.path.abspath(__file__))


def user_data_dir():
    base = os.path.expanduser("~/Library/Application Support/PikminGPS")
    os.makedirs(base, exist_ok=True)
    return base


def run_tunneld():
    """Run `pymobiledevice3 remote tunneld` in-process.

    Invoked when the bundled binary is launched with `--tunneld`, normally
    via `osascript ... with administrator privileges` so it runs as root.
    """
    import runpy
    sys.argv = ['pymobiledevice3', 'remote', 'tunneld']
    runpy.run_module('pymobiledevice3', run_name='__main__')


def main():
    if len(sys.argv) > 1 and sys.argv[1] == '--tunneld':
        run_tunneld()
        return

    res = resource_dir()
    data = user_data_dir()

    os.chdir(data)

    # Seed favorites.json into user data dir on first run.
    fav_user = os.path.join(data, "favorites.json")
    if not os.path.exists(fav_user):
        bundled = os.path.join(res, "favorites.json")
        if os.path.exists(bundled):
            with open(bundled, "r", encoding="utf-8") as src, open(fav_user, "w", encoding="utf-8") as dst:
                dst.write(src.read())
        else:
            with open(fav_user, "w", encoding="utf-8") as f:
                f.write("[]")

    # Make sure Flask finds templates/static bundled inside the .app.
    sys.path.insert(0, res)
    os.environ["FLASK_TEMPLATES"] = os.path.join(res, "templates")
    os.environ["FLASK_STATIC"] = os.path.join(res, "static")

    import app as app_module

    app_module.app.template_folder = os.path.join(res, "templates")
    app_module.app.static_folder = os.path.join(res, "static")
    app_module.FAVORITES_FILE = fav_user
    app_module.state["favorites"] = app_module.load_favorites()

    url = "http://localhost:9527"

    def open_browser():
        time.sleep(1.5)
        webbrowser.open(url)

    threading.Thread(target=open_browser, daemon=True).start()

    print("=" * 50)
    print(f"  PikminGPS Web — {url}")
    print("=" * 50)
    app_module.socketio.run(
        app_module.app,
        host="0.0.0.0",
        port=9527,
        debug=False,
        allow_unsafe_werkzeug=True,
    )


if __name__ == "__main__":
    main()
