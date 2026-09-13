"""Public, credential-free yt-dlp boundary. Run only with an isolated pinned Python.

All Python networking is checked at the actual numeric socket connection, not
merely at source validation. No native request handlers, plugins or subprocesses
are permitted. The parent kills this process group on deadline/cancellation.
"""
import functools
import ipaddress
import json
import math
import os
from pathlib import Path
import resource
import socket
import sys
import urllib.parse
import urllib.request

MAX_BYTES = 50 * 1024 * 1024
MAX_DURATION = 1800
MAX_NETWORK_BYTES = 100 * 1024 * 1024
V4_BLOCKS = tuple(ipaddress.ip_network(value) for value in (
    '0.0.0.0/8', '10.0.0.0/8', '100.64.0.0/10', '127.0.0.0/8',
    '169.254.0.0/16', '172.16.0.0/12', '192.0.0.0/24', '192.0.2.0/24',
    '192.88.99.0/24', '192.168.0.0/16', '198.18.0.0/15',
    '198.51.100.0/24', '203.0.113.0/24', '224.0.0.0/4', '240.0.0.0/4'))
V6_GLOBAL = ipaddress.ip_network('2000::/3')
V6_BLOCKS = tuple(ipaddress.ip_network(value) for value in (
    '2001::/23', '2001:db8::/32', '2002::/16', '3fff::/20'))


class BoundaryError(Exception):
    pass


class TooLarge(BoundaryError):
    pass


class Unsupported(BoundaryError):
    pass


def is_public_address(address):
    try:
        if not isinstance(address, str) or '%' in address:
            return False
        ip = ipaddress.ip_address(address)
        if ip.version == 4:
            return not any(ip in block for block in V4_BLOCKS)
        return ip in V6_GLOBAL and not any(ip in block for block in V6_BLOCKS)
    except ValueError:
        return False


def public_url(raw):
    if not isinstance(raw, str) or len(raw) > 16384 or any(ord(c) < 32 for c in raw):
        raise BoundaryError('Invalid URL')
    try:
        url = urllib.parse.urlsplit(raw)
        if url.scheme not in ('https', 'http') or not url.hostname or url.username is not None or url.password is not None:
            raise BoundaryError('Invalid URL')
        if url.port not in (None, 443 if url.scheme == 'https' else 80):
            raise BoundaryError('Invalid port')
        try:
            ipaddress.ip_address(url.hostname)
        except ValueError:
            if '%' in url.hostname:
                raise BoundaryError('Invalid hostname')
        else:
            if not is_public_address(url.hostname):
                raise BoundaryError('Private address')
        return raw
    except ValueError as error:
        raise BoundaryError('Invalid URL') from error


def install_network_guard():
    original_getaddrinfo = socket.getaddrinfo
    request_count = 0

    def resolve(*args, **kwargs):
        answers = original_getaddrinfo(*args, **kwargs)
        if not answers or any(not is_public_address(answer[4][0]) for answer in answers):
            raise BoundaryError('DNS returned a nonpublic address')
        return answers

    socket.getaddrinfo = resolve

    def audit(event, args):
        nonlocal request_count
        if event == 'socket.__new__':
            _, family, kind, protocol = args
            if family not in (socket.AF_INET, socket.AF_INET6) or kind != socket.SOCK_STREAM or protocol not in (0, socket.IPPROTO_TCP):
                raise BoundaryError('Only public TCP is permitted')
        elif event == 'socket.connect':
            sock, address = args
            if sock.family not in (socket.AF_INET, socket.AF_INET6) or sock.type != socket.SOCK_STREAM or not isinstance(address, tuple) or len(address) < 2 or address[1] not in (80, 443) or not is_public_address(address[0]):
                raise BoundaryError('Connection target is not a numeric public HTTP address')
        elif event in ('socket.bind', 'socket.sendto', 'socket.sendmsg'):
            raise BoundaryError('Listening and datagram networking are disabled')
        elif event == 'urllib.Request':
            public_url(args[0])
            request_count += 1
            if request_count > 100:
                raise BoundaryError('Request budget exceeded')
        elif event in ('subprocess.Popen', 'os.system', 'os.exec', 'os.posix_spawn', 'os.fork', 'os.forkpty'):
            raise BoundaryError('Extractor subprocesses are disabled')

    sys.addaudithook(audit)


class PublicRedirectHandler(urllib.request.HTTPRedirectHandler):
    max_redirections = 5
    max_repeats = 2

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        public_url(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def write_response(response, output, maximum):
    written = 0
    try:
        declared = response.headers.get('Content-Length')
        if declared and int(declared) > maximum:
            raise TooLarge('Declared size exceeds limit')
        with open(output, 'xb') as handle:
            while True:
                chunk = response.read(min(64 * 1024, maximum - written + 1))
                if not chunk:
                    break
                written += len(chunk)
                if written > maximum:
                    raise TooLarge('Download exceeds limit')
                handle.write(chunk)
        if not written:
            raise BoundaryError('Empty video')
        if declared and int(declared) != written:
            raise BoundaryError('Truncated video')
    except BaseException:
        output.unlink(missing_ok=True)
        raise


class QuietLogger:
    def debug(self, *args, **kwargs):
        pass

    info = warning = error = debug


def select_progressive_format(context, maximum):
    """Prefer the best picture up to a 720p short edge within the byte budget.

    yt-dlp populates filesize_approx from bitrate and actual source duration
    before calling this selector. Unknown sizes remain candidates; only the
    subsequent bounded streaming write can establish that they fit.
    """
    def positive(value):
        return value if isinstance(value, (int, float)) and math.isfinite(value) and value > 0 else None

    def codec_matches(value, prefixes):
        return value in (None, 'unknown') or any(str(value).startswith(prefix) for prefix in prefixes)

    candidates = []
    oversized = False
    for candidate in context['formats']:
        if candidate.get('ext') != 'mp4' or candidate.get('protocol') not in ('http', 'https'):
            continue
        if not codec_matches(candidate.get('vcodec'), ('avc1', 'avc3', 'h264')) or not codec_matches(candidate.get('acodec'), ('mp4a.40', 'aac')):
            continue
        size = positive(candidate.get('filesize')) or positive(candidate.get('filesize_approx'))
        if size is not None and size > maximum:
            oversized = True
            continue
        width, height = positive(candidate.get('width')), positive(candidate.get('height'))
        resolution = min(width, height) if width and height else height or width or 0
        # Use the highest resolution up to the target. If only larger formats
        # exist, choose the closest above it; unknown dimensions rank last.
        rank = (2, resolution) if 0 < resolution <= 720 else (1, -resolution) if resolution > 720 else (0, 0)
        candidates.append(((*rank, positive(candidate.get('tbr')) or 0, positive(candidate.get('fps')) or 0), candidate))
    if candidates:
        yield max(candidates, key=lambda item: item[0])[1]
    elif oversized:
        raise TooLarge('All compatible formats exceed the size budget')


def extractor_options(maximum, duration):
    return {
        'quiet': True, 'no_warnings': True, 'logger': QuietLogger(),
        'proxy': '', 'geo_verification_proxy': '', 'usenetrc': False,
        'cookiefile': None, 'cookiesfrombrowser': None, 'cachedir': False,
        'js_runtimes': {}, 'remote_components': [], 'enable_file_urls': False,
        'external_downloader': {}, 'fixup': 'never', 'postprocessors': [],
        'outtmpl': 'video.mp4', 'noplaylist': True, 'playlistend': 1,
        'extract_flat': 'in_playlist', 'lazy_playlist': True,
        'max_downloads': 1, 'max_filesize': maximum,
        'socket_timeout': 10, 'retries': 0, 'fragment_retries': 0,
        'extractor_retries': 0, 'file_access_retries': 0,
        'concurrent_fragment_downloads': 1, 'hls_prefer_native': True,
        'continuedl': False, 'nopart': True, 'overwrites': False,
        'writethumbnail': False, 'writeinfojson': False, 'writesubtitles': False,
        'writeautomaticsub': False, 'getcomments': False,
        # Progressive MP4 requires no external downloader/muxer/runtime. A direct
        # MP4 may have unknown codec metadata; ffprobe independently checks it.
        'format': lambda context: select_progressive_format(context, maximum),
        'check_formats': False,
        'match_filter': lambda info, **kwargs: 'unsupported stream' if info.get('is_live') or (info.get('duration') or 0) > duration else None,
    }


def validate_info(info, duration):
    if not isinstance(info, dict) or info.get('_type', 'video') != 'video' or 'entries' in info or info.get('is_live') or info.get('live_status') in ('is_live', 'is_upcoming', 'post_live'):
        raise Unsupported('Only a single recorded video is supported')
    seconds = info.get('duration')
    if seconds is not None and (not isinstance(seconds, (int, float)) or not math.isfinite(seconds) or seconds <= 0 or seconds > duration):
        raise Unsupported('Duration exceeds limit')


class Budget:
    def __init__(self):
        self.bytes = 0
        self.requests = 0


class BoundedResponse:
    """Every extractor, downloader and subtitle read shares one request budget."""
    def __init__(self, response, budget):
        self.response = response
        self.budget = budget

    def __getattr__(self, name):
        return getattr(self.response, name)

    def read(self, size=-1):
        remaining = MAX_NETWORK_BYTES - self.budget.bytes
        data = self.response.read(min(size if size is not None and size >= 0 else remaining + 1, remaining + 1))
        self.budget.bytes += len(data)
        if self.budget.bytes > MAX_NETWORK_BYTES:
            self.close()
            raise TooLarge('Network budget exceeded')
        return data

    def close(self):
        self.response.close()

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.close()


def extract(source, maximum, duration):
    import yt_dlp
    from yt_dlp.globals import all_plugins_loaded, plugin_dirs
    from yt_dlp.networking._urllib import UrllibRH
    from yt_dlp.version import __version__
    if __version__ != '2026.08.19':
        raise BoundaryError('Unreviewed yt-dlp version')
    # Embedding bypasses CLI configuration; disable plugin discovery before
    # constructing YoutubeDL (the pinned internal API is deliberately tested).
    plugin_dirs.value = []
    all_plugins_loaded.value = True
    budget = Budget()

    class PublicYoutubeDL(yt_dlp.YoutubeDL):
        @functools.cached_property
        def _request_director(self):
            return self.build_request_director([UrllibRH])

        def urlopen(self, req):
            public_url(req if isinstance(req, str) else req.url)
            budget.requests += 1
            if budget.requests > 100:
                raise BoundaryError('Request budget exceeded')
            return BoundedResponse(super().urlopen(req), budget)

    with PublicYoutubeDL(extractor_options(maximum, duration)) as downloader:
        info = downloader.extract_info(source, download=False)
        validate_info(info, duration)
        if info.get('protocol') not in ('http', 'https') or info.get('ext') != 'mp4' or info.get('requested_formats'):
            raise Unsupported('No progressive MP4 available')
        public_url(info['url'])
        if info.get('filesize') and info['filesize'] > maximum:
            raise TooLarge('Video exceeds limit')
        # Fixed path; use the selected HTTP format without re-extracting the
        # source, writing sidecars, or permitting any postprocessor to execute.
        from yt_dlp.networking import Request
        with downloader.urlopen(Request(info['url'], headers=info.get('http_headers', {}))) as response:
            write_response(response, Path('video.mp4'), maximum)
        subtitles = []
        for automatic, collection in ((False, info.get('subtitles')), (True, info.get('automatic_captions'))):
            if subtitles or not isinstance(collection, dict):
                continue
            languages = sorted(collection, key=lambda language: (not language.startswith('en'), language))
            for language in languages[:2]:
                tracks = collection[language]
                track = next((entry for entry in tracks if entry.get('ext') == 'vtt' and entry.get('url')), None)
                if not track:
                    continue
                try:
                    with downloader.urlopen(track['url']) as response:
                        data = response.read(32_001)
                    if len(data) <= 32_000 and data.lstrip(b'\xef\xbb\xbf').startswith(b'WEBVTT'):
                        subtitles.append({'language': language[:32], 'automatic': automatic, 'text': data.decode('utf-8', 'replace')})
                except Exception:
                    # Optional evidence must never become a fabricated transcript.
                    continue
        return {'status': 'downloaded', 'title': str(info.get('title') or '')[:1000],
                'description': str(info.get('description') or '')[:16000],
                'author': str(info.get('uploader') or info.get('creator') or '')[:500], 'subtitles': subtitles}


def main():
    os.umask(0o077)
    resource.setrlimit(resource.RLIMIT_AS, (768 * 1024 * 1024,) * 2)
    resource.setrlimit(resource.RLIMIT_CPU, (60, 60))
    resource.setrlimit(resource.RLIMIT_FSIZE, (MAX_BYTES, MAX_BYTES))
    resource.setrlimit(resource.RLIMIT_NOFILE, (64, 64))
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    install_network_guard()
    result = {'status': 'error'}
    try:
        payload = sys.stdin.buffer.read(8193)
        if len(payload) > 8192:
            raise BoundaryError('Oversized input')
        options = json.loads(payload)
        source = public_url(options['url'])
        maximum = min(MAX_BYTES, max(1, int(options['maxBytes'])))
        duration = min(MAX_DURATION, max(1, int(options['maxDurationSeconds'])))
        resource.setrlimit(resource.RLIMIT_FSIZE, (maximum, maximum))
        # Direct URLs do not need a platform extractor, but use the same actual
        # connection guard, verified TLS, redirect checks and streaming limits.
        if urllib.parse.urlsplit(source).path.lower().endswith('.mp4'):
            opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), PublicRedirectHandler())
            request = urllib.request.Request(source, headers={'Accept': 'video/mp4', 'Accept-Encoding': 'identity', 'User-Agent': 'Foundkeep-Public-Media/1.0'})
            with opener.open(request, timeout=10) as response:
                write_response(response, Path('video.mp4'), maximum)
            result = {'status': 'downloaded', 'subtitles': []}
        else:
            result = extract(source, maximum, duration)
    except TooLarge:
        result = {'status': 'too_large'}
    except Unsupported:
        result = {'status': 'unsupported'}
    except BoundaryError:
        result = {'status': 'error'}
    except Exception:
        result = {'status': 'unavailable'}
    print(json.dumps(result, ensure_ascii=True))


if __name__ == '__main__':
    main()
