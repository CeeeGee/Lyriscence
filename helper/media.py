import asyncio, json, sys, io, base64, threading, time, hashlib, colorsys, ctypes
from datetime import datetime, timezone
from PIL import Image
import winrt.windows.foundation          # noqa: needed so async calls can be awaited
import winrt.windows.foundation.collections  # noqa
from winrt.windows.media.control import (
    GlobalSystemMediaTransportControlsSessionManager as Manager,
    GlobalSystemMediaTransportControlsSessionPlaybackStatus as Status,
)
from winrt.windows.storage.streams import DataReader, Buffer, InputStreamOptions

CURRENT = {"s": None}


VK_NEXT, VK_PREV, VK_PLAY = 0xB0, 0xB1, 0xB3


def press_media_key(vk):
    # same thing the keyboard's media keys do - works for Spotify, browsers, etc. even when the
    # app does not expose "skip" to Windows' media controls
    try:
        u = ctypes.windll.user32
        u.keybd_event(vk, 0, 0, 0)
        u.keybd_event(vk, 0, 2, 0)
    except Exception as e:
        print(f"media key error: {e}", file=sys.stderr, flush=True)


async def run_cmd(cmd):
    s = CURRENT["s"]
    try:
        if cmd == "toggle":
            ok = await s.try_toggle_play_pause_async() if s else False
            if not ok:
                press_media_key(VK_PLAY)
        elif cmd == "next":
            ok = await s.try_skip_next_async() if s else False
            if not ok:
                press_media_key(VK_NEXT)
        elif cmd == "prev":
            ok = await s.try_skip_previous_async() if s else False
            if not ok:
                press_media_key(VK_PREV)
    except Exception as e:
        print(f"command error: {e}", file=sys.stderr, flush=True)
        press_media_key({"toggle": VK_PLAY, "next": VK_NEXT, "prev": VK_PREV}.get(cmd, 0))


def stdin_reader(loop):
    # the Electron app writes one command per line: toggle / next / prev
    for line in sys.stdin:
        cmd = line.strip()
        if cmd:
            asyncio.run_coroutine_threadsafe(run_cmd(cmd), loop)


def pick(manager):
    # prefer whichever app is actually playing right now
    for s in manager.get_sessions():
        if s.get_playback_info().playback_status == Status.PLAYING:
            return s
    return manager.get_current_session()


async def read_art(props):
    try:
        ref = props.thumbnail
        if ref is None:
            return None
        stream = await ref.open_read_async()
        size = stream.size
        buf = Buffer(size)
        await stream.read_async(buf, size, InputStreamOptions.READ_AHEAD)
        reader = DataReader.from_buffer(buf)
        data = bytearray(buf.length)
        reader.read_bytes(data)
        return bytes(data)
    except Exception as e:
        print(f"art error: {e}", file=sys.stderr, flush=True)
        return None


def analyse(raw):
    """Returns (primary_rgb | None, secondary_rgb | None, small_jpeg_base64).
    Colours are picked from a hue histogram weighted by saturation x brightness, so a vivid cover gives its real
    colour. Greyscale covers give None (the app then falls back to the song's mood)."""
    img = Image.open(io.BytesIO(raw)).convert("RGB")
    small = img.resize((48, 48))
    bins = [[0.0, 0.0, 0.0, 0.0] for _ in range(24)]          # weight, r, g, b per 15-degree hue bin
    for (r, g, b) in small.getdata():
        h, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
        if s < 0.18 or v < 0.2:
            continue
        w = (s ** 1.2) * v
        k = int(h * 24) % 24
        bk = bins[k]
        bk[0] += w; bk[1] += r * w; bk[2] += g * w; bk[3] += b * w

    def smooth(k):
        return bins[k][0] + 0.5 * (bins[(k - 1) % 24][0] + bins[(k + 1) % 24][0])

    scores = [smooth(k) for k in range(24)]
    total = sum(bk[0] for bk in bins)

    def colour_at(k):
        w = r = g = b = 0.0
        for kk in (k - 1, k, k + 1):
            bk = bins[kk % 24]
            w += bk[0]; r += bk[1]; g += bk[2]; b += bk[3]
        return [round(r / w), round(g / w), round(b / w)] if w else None

    primary = secondary = None
    if total > 8:                                              # enough colourful pixels to trust
        k1 = max(range(24), key=lambda k: scores[k])
        primary = colour_at(k1)
        far = [k for k in range(24) if min((k - k1) % 24, (k1 - k) % 24) >= 3]
        if far:
            k2 = max(far, key=lambda k: scores[k])
            if scores[k2] >= 0.25 * scores[k1]:
                secondary = colour_at(k2)

    img.thumbnail((160, 160))
    out = io.BytesIO()
    img.save(out, "JPEG", quality=80)
    return primary, secondary, base64.b64encode(out.getvalue()).decode()


async def main():
    manager = await Manager.request_async()
    threading.Thread(target=stdin_reader, args=(asyncio.get_running_loop(),), daemon=True).start()
    st = {"key": None, "color": None, "color2": None, "art": None, "hash": None,
          "prev_hash": None, "t0": 0.0, "last_try": 0.0}
    while True:
        s = pick(manager)
        CURRENT["s"] = s
        if s:
            try:
                props = await s.try_get_media_properties_async()
                tl = s.get_timeline_properties()
                playing = s.get_playback_info().playback_status == Status.PLAYING
                pos = tl.position.total_seconds()
                if playing:
                    pos += (datetime.now(timezone.utc) - tl.last_updated_time).total_seconds()
                dur = (tl.end_time - tl.start_time).total_seconds()
                if dur > 0:
                    pos = min(pos, dur)

                now = time.monotonic()
                key = f"{props.title}|{props.artist}"
                if key != st["key"]:
                    # new song: forget the old colours, remember the old cover so a stale thumbnail is not mistaken for the new one
                    st.update(key=key, color=None, color2=None, art=None, prev_hash=st["hash"], hash=None, t0=now, last_try=0.0)

                # Windows often still returns the PREVIOUS song's cover for a moment after a track change,
                # so keep re-reading for a while and take whatever differs from the old cover.
                if now - st["t0"] < 20 and now - st["last_try"] >= 0.5:
                    st["last_try"] = now
                    raw = await read_art(props)
                    if raw:
                        h = hashlib.md5(raw).hexdigest()
                        stale = (h == st["prev_hash"] and now - st["t0"] < 6)
                        if not stale and h != st["hash"]:
                            try:
                                c1, c2, art = analyse(raw)
                                st.update(color=c1, color2=c2, art=art, hash=h)
                            except Exception as e:
                                print(f"analyse error: {e}", file=sys.stderr, flush=True)

                print(json.dumps({
                    "title": props.title, "artist": props.artist,
                    "album": props.album_title, "duration": dur,
                    "position": max(pos, 0), "playing": playing,
                    "app": s.source_app_user_model_id,
                    "color": st["color"], "color2": st["color2"], "art": st["art"],
                }), flush=True)
            except Exception as e:
                print(f"helper error: {e}", file=sys.stderr, flush=True)
        await asyncio.sleep(0.25)


asyncio.run(main())
