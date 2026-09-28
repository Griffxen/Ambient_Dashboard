"""Read the active MPRIS session without adding a desktop dependency."""
import json

try:
    import dbus

    bus = dbus.SessionBus()
    sessions = [name for name in bus.list_names() if name.startswith("org.mpris.MediaPlayer2.")]
    result = None
    for name in sessions:
        obj = bus.get_object(name, "/org/mpris/MediaPlayer2")
        props = dbus.Interface(obj, "org.freedesktop.DBus.Properties")
        status = str(props.Get("org.mpris.MediaPlayer2.Player", "PlaybackStatus"))
        if status != "Playing":
            continue
        meta = props.Get("org.mpris.MediaPlayer2.Player", "Metadata")
        artists = meta.get("xesam:artist", [])
        result = {
            "title": str(meta.get("xesam:title", ""))[:150],
            "artist": ", ".join(str(x) for x in artists)[:150],
            "album": str(meta.get("xesam:album", ""))[:150],
            "artUrl": str(meta.get("mpris:artUrl", ""))[:500],
            "durationUs": int(meta.get("mpris:length", 0)),
            "status": status,
        }
        try:
            result["positionUs"] = int(props.Get("org.mpris.MediaPlayer2.Player", "Position"))
        except Exception:
            result["positionUs"] = 0
        break
    print(json.dumps(result, ensure_ascii=False))
except Exception:
    print("null")
