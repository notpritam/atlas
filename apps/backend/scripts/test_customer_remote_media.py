"""Deterministic network-boundary tests; no public network required."""
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True
HELPER = Path(__file__).with_name('customer-remote-media.py')
spec = importlib.util.spec_from_file_location('remote_media', HELPER)
media = importlib.util.module_from_spec(spec)
spec.loader.exec_module(media)


class BoundaryTests(unittest.TestCase):
    def test_real_socket_audit_rejects_private_hostname_unix_and_datagram(self):
        # Run in a child because audit hooks are deliberately permanent.
        script = '''
import importlib.util,socket,sys
spec=importlib.util.spec_from_file_location('media',sys.argv[1]); m=importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
m.install_network_guard()
for address in [('127.0.0.1',80),('169.254.169.254',80),('10.0.0.1',443),('example.com',443),('93.184.216.34',22)]:
    try: socket.socket().connect(address)
    except m.BoundaryError: pass
    else: raise AssertionError(address)
for family,kind in [(socket.AF_UNIX,socket.SOCK_STREAM),(socket.AF_INET,socket.SOCK_DGRAM),(socket.AF_INET6,socket.SOCK_RAW)]:
    try: socket.socket(family,kind)
    except m.BoundaryError: pass
    else: raise AssertionError((family,kind))
try: socket.socket(socket.AF_INET6).connect(('::ffff:127.0.0.1',443))
except m.BoundaryError: pass
else: raise AssertionError('mapped IPv6')
for count in range(100): sys.audit('urllib.Request','https://example.com/request',None,{},'GET')
try: sys.audit('urllib.Request','https://example.com/request',None,{},'GET')
except m.BoundaryError: pass
else: raise AssertionError('request budget not enforced at transport')
print('guarded')
'''
        child = subprocess.run([sys.executable, '-I', '-B', '-c', script, str(HELPER)], capture_output=True, text=True)
        self.assertEqual(child.returncode, 0, child.stderr)
        self.assertEqual(child.stdout.strip(), 'guarded')

    def test_dns_rebinding_and_mixed_answers_fail_closed(self):
        script = '''
import importlib.util,socket,sys
spec=importlib.util.spec_from_file_location('media',sys.argv[1]); m=importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
answers=[(socket.AF_INET,socket.SOCK_STREAM,6,'',('93.184.216.34',443))]
socket.getaddrinfo=lambda *args,**kwargs: answers
m.install_network_guard()
assert socket.getaddrinfo('cdn.example.com',443)[0][4][0]=='93.184.216.34'
answers.append((socket.AF_INET,socket.SOCK_STREAM,6,'',('127.0.0.1',443)))
try: socket.getaddrinfo('cdn.example.com',443)
except m.BoundaryError: pass
else: raise AssertionError('mixed DNS answers accepted')
answers.pop(0)
try: socket.getaddrinfo('cdn.example.com',443)
except m.BoundaryError: pass
else: raise AssertionError('rebound DNS accepted')
import subprocess
try: subprocess.run(['/bin/true'])
except m.BoundaryError: pass
else: raise AssertionError('extractor subprocess accepted')
'''
        child = subprocess.run([sys.executable, '-I', '-B', '-c', script, str(HELPER)], capture_output=True, text=True)
        self.assertEqual(child.returncode, 0, child.stderr)

    def test_actual_ytdlp_parsing_and_file_download_uses_only_guarded_transport(self):
        import yt_dlp
        from yt_dlp.globals import all_plugins_loaded, plugin_dirs
        from yt_dlp.networking import Response
        from yt_dlp.networking._urllib import UrllibRH
        # Replace only the HTTP transport. The pinned extractor, format parser,
        # plugin isolation, response budgets and file writer all run unchanged.
        payload = bytes([0, 0, 0, 24]) + b'ftypmp42' + b'x' * 24
        requests = []
        def transport(handler, request):
            requests.append(request.url)
            return Response(io.BytesIO(payload), request.url, {'Content-Type': 'video/mp4', 'Content-Length': str(len(payload))})
        with tempfile.TemporaryDirectory() as directory:
            previous = os.getcwd()
            try:
                os.chdir(directory)
                Path('yt-dlp.conf').write_text('--exec touch CONFIG_EXECUTED')
                plugins = Path('plugins/yt_dlp_plugins/extractor')
                plugins.mkdir(parents=True)
                (plugins / 'evil.py').write_text('from pathlib import Path; Path("PLUGIN_EXECUTED").touch()')
                plugin_dirs.value = [str(Path('plugins').absolute())]
                all_plugins_loaded.value = False
                with patch.object(UrllibRH, '_send', transport):
                    result = media.extract('https://example.com/download?id=1', 1024, 1800)
                self.assertEqual(result['status'], 'downloaded')
                self.assertEqual(Path('video.mp4').read_bytes(), payload)
                self.assertFalse(Path('CONFIG_EXECUTED').exists())
                self.assertFalse(Path('PLUGIN_EXECUTED').exists())
                self.assertEqual(requests, ['https://example.com/download?id=1'] * 2)
            finally:
                os.chdir(previous)

    def test_realistic_formats_choose_720p_and_fall_back_within_byte_budget(self):
        import copy
        from yt_dlp import YoutubeDL
        from yt_dlp.globals import all_plugins_loaded, plugin_dirs
        plugin_dirs.value = []
        all_plugins_loaded.value = True
        mib = 1024 * 1024
        formats = [
            {'format_id': '270p', 'height': 270, 'width': 480, 'filesize': 2 * mib, 'tbr': 150},
            {'format_id': '480p', 'height': 480, 'width': 854, 'filesize': 12 * mib, 'tbr': 900},
            {'format_id': '720p', 'height': 720, 'width': 1280, 'filesize': 28 * mib, 'tbr': 2100},
            {'format_id': '720p-large', 'height': 720, 'width': 1280, 'filesize': 70 * mib, 'tbr': 5200},
            {'format_id': '1080p', 'height': 1080, 'width': 1920, 'filesize': 40 * mib, 'tbr': 3000},
            {'format_id': '720p-vp9', 'height': 720, 'width': 1280, 'filesize': 20 * mib, 'vcodec': 'vp09.00.31.08'},
            {'format_id': '720p-video-only', 'height': 720, 'width': 1280, 'filesize': 15 * mib, 'acodec': 'none'},
        ]
        for entry in formats:
            entry.update({'url': 'https://cdn.example.com/' + entry['format_id'] + '.mp4', 'ext': 'mp4', 'protocol': 'https'})
            entry.setdefault('vcodec', 'avc1.64001f')
            entry.setdefault('acodec', 'mp4a.40.2')
        def select(candidates, maximum):
            with YoutubeDL(media.extractor_options(maximum, 1800)) as downloader:
                info = downloader.process_ie_result({'id': 'fixture', 'title': 'Fixture', 'extractor': 'generic', 'extractor_key': 'Generic', 'duration': 120, 'formats': copy.deepcopy(candidates)}, download=False)
                return info['format_id']
        self.assertEqual(select(formats, 50 * mib), '720p')
        self.assertEqual(select(formats, 20 * mib), '480p')
        self.assertEqual(select(formats, 5 * mib), '270p')
        with self.assertRaises(media.TooLarge):
            select(formats, 1 * mib)
        # A 4000 kbit/s format over 120 s is about 60 MB, so the real yt-dlp
        # duration/bitrate estimate must exclude it even without Content-Length.
        estimated = copy.deepcopy(formats)
        estimated[2].pop('filesize')
        estimated[2]['tbr'] = 4000
        estimated = [entry for entry in estimated if entry['format_id'] != '1080p']
        self.assertEqual(select(estimated, 50 * mib), '480p')
        unknown = copy.deepcopy(formats[:3])
        unknown[2].pop('filesize')
        unknown[2].pop('tbr')
        self.assertEqual(select(unknown, 50 * mib), '720p')

    def test_silent_progressive_source_is_allowed_but_separate_audio_is_not_dropped(self):
        silent = {'format_id': 'silent', 'url': 'https://cdn.example.com/silent.mp4',
                  'protocol': 'https', 'ext': 'mp4', 'vcodec': 'avc1.64001f', 'acodec': 'none',
                  'width': 480, 'height': 854, 'filesize': 918120}
        self.assertEqual(list(media.select_progressive_format({'formats': [silent]}, 50 * 1024 * 1024)), [silent])
        audio = {'format_id': 'audio', 'url': 'https://cdn.example.com/audio.m4a',
                 'protocol': 'https', 'ext': 'm4a', 'vcodec': 'none', 'acodec': 'mp4a.40.2'}
        self.assertEqual(list(media.select_progressive_format({'formats': [silent, audio]}, 50 * 1024 * 1024)), [])
        adaptive = {**silent, 'container': 'mp4_dash', 'manifest_url': 'https://cdn.example.com/manifest.mpd'}
        self.assertEqual(list(media.select_progressive_format({'formats': [adaptive]}, 50 * 1024 * 1024)), [])

    def test_real_direct_and_ytdlp_redirect_bodies_share_the_early_budget(self):
        from email.message import Message
        from yt_dlp.networking import Request
        import urllib.request
        for platform in (False, True):
            with self.subTest(platform=platform):
                bodies = []
                def transport(handler, connection, request, **kwargs):
                    headers = Message()
                    is_redirect = request.full_url.endswith('/start')
                    if is_redirect:
                        headers['Location'] = 'https://cdn.example.com/final'
                    body = io.BytesIO(b'x' * 65 if is_redirect else b'ok')
                    bodies.append(body)
                    result = urllib.request.addinfourl(body, headers, request.full_url, 302 if is_redirect else 200)
                    result.msg = 'Found' if is_redirect else 'OK'
                    return result
                budget = media.Budget()
                with patch.object(media, 'MAX_NETWORK_BYTES', 64), patch.object(urllib.request.AbstractHTTPHandler, 'do_open', transport):
                    with self.assertRaises(media.TooLarge):
                        if platform:
                            with media.public_request_handler(budget)(logger=media.QuietLogger(), proxies={}) as handler:
                                handler.send(Request('https://example.com/start'))
                        else:
                            opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), media.PublicRedirectHandler(), media.ResponseBudgetHandler(budget))
                            opener.open('https://example.com/start')
                    self.assertEqual(budget.wire_bytes, 65)
                    self.assertEqual(len(bodies), 1)
                    self.assertTrue(bodies[0].closed)

    def test_real_error_responses_remain_bounded_when_consumed_by_extractors(self):
        from email.message import Message
        from yt_dlp.networking import Request
        from yt_dlp.networking.exceptions import HTTPError
        import urllib.error
        import urllib.request
        for platform in (False, True):
            with self.subTest(platform=platform):
                def transport(handler, connection, request, **kwargs):
                    response = urllib.request.addinfourl(io.BytesIO(b'x' * 65), Message(), request.full_url, 403)
                    response.msg = 'Forbidden'
                    return response
                budget = media.Budget()
                with patch.object(media, 'MAX_NETWORK_BYTES', 64), patch.object(urllib.request.AbstractHTTPHandler, 'do_open', transport):
                    if platform:
                        with media.public_request_handler(budget)(logger=media.QuietLogger(), proxies={}) as handler:
                            with self.assertRaises(HTTPError) as error:
                                handler.send(Request('https://example.com/error'))
                            response = error.exception.response
                    else:
                        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), media.PublicRedirectHandler(), media.ResponseBudgetHandler(budget))
                        with self.assertRaises(urllib.error.HTTPError) as error:
                            opener.open('https://example.com/error')
                        response = error.exception
                    with self.assertRaises(media.TooLarge):
                        response.read()
                    self.assertEqual(budget.wire_bytes, 65)
                    response.close()

    def test_compressed_response_is_bounded_before_ytdlp_eager_decompression(self):
        import gzip
        from email.message import Message
        from yt_dlp.networking import Request
        import urllib.request
        compressed = gzip.compress(b'x' * 1024)
        for platform in (False, True):
            with self.subTest(platform=platform):
                def transport(handler, connection, request, **kwargs):
                    headers = Message()
                    headers['Content-Encoding'] = 'gzip'
                    headers['Content-Length'] = str(len(compressed))
                    response = urllib.request.addinfourl(io.BytesIO(compressed), headers, request.full_url, 200)
                    response.msg = 'OK'
                    return response
                budget = media.Budget()
                with patch.object(media, 'MAX_NETWORK_BYTES', 64), patch.object(urllib.request.AbstractHTTPHandler, 'do_open', transport):
                    with self.assertRaises(media.TooLarge):
                        if platform:
                            with media.public_request_handler(budget)(logger=media.QuietLogger(), proxies={}) as handler:
                                with handler.send(Request('https://example.com/compressed')) as response:
                                    response.read()
                        else:
                            opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), media.PublicRedirectHandler(), media.ResponseBudgetHandler(budget))
                            with opener.open('https://example.com/compressed') as response:
                                response.read()
                    self.assertEqual(budget.bytes, 65)

    def test_ordinary_redirects_and_compression_preserve_exact_bodies_and_accounting(self):
        import gzip
        import zlib
        from email.message import Message
        from yt_dlp.networking import Request
        import urllib.request
        plain = b'normal response body'
        compressed_bodies = [('gzip', gzip.compress(plain)), ('deflate', zlib.compress(plain)), ('deflate', zlib.compress(plain)[2:-4])]
        for platform in (False, True):
            for encoding, compressed in compressed_bodies:
                with self.subTest(platform=platform, encoding=encoding, compressed=compressed):
                    def transport(handler, connection, request, **kwargs):
                        headers = Message()
                        redirect = request.full_url.endswith('/start')
                        if redirect:
                            headers['Location'] = 'https://cdn.example.com/final'
                            body = b'redirect'
                        else:
                            headers['Content-Encoding'] = encoding
                            headers['Content-Length'] = str(len(compressed))
                            body = compressed
                        response = urllib.request.addinfourl(io.BytesIO(body), headers, request.full_url, 302 if redirect else 200)
                        response.msg = 'Found' if redirect else 'OK'
                        return response
                    budget = media.Budget()
                    with patch.object(urllib.request.AbstractHTTPHandler, 'do_open', transport):
                        if platform:
                            with media.public_request_handler(budget)(logger=media.QuietLogger(), proxies={}) as handler:
                                with handler.send(Request('https://example.com/start')) as response:
                                    self.assertEqual(response.read(), plain)
                                    self.assertIsNone(response.headers.get('Content-Length'))
                        else:
                            opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), media.PublicRedirectHandler(), media.ResponseBudgetHandler(budget))
                            with opener.open('https://example.com/start') as response:
                                self.assertEqual(response.read(), plain)
                                self.assertIsNone(response.headers.get('Content-Length'))
                    self.assertEqual(budget.bytes, len(b'redirect') + len(plain))
                    self.assertEqual(budget.wire_bytes, len(b'redirect') + len(compressed))

    def test_shared_response_budget_rejects_oversized_extractor_body(self):
        budget = media.Budget()
        budget.bytes = media.MAX_NETWORK_BYTES - 2
        response = media.BoundedResponse(io.BytesIO(b'123'), budget)
        with self.assertRaises(media.TooLarge):
            response.read()


    def test_address_ranges_match_existing_preview_policy(self):
        for address in ['127.1.2.3', '100.64.0.1', '192.0.0.9', '192.88.99.1', '198.18.0.1', '203.0.113.1', '224.0.0.1', '::1', '::ffff:8.8.8.8', '2001:db8::1', '2002:0808:0808::', '3fff::1']:
            self.assertFalse(media.is_public_address(address), address)
        for address in ['8.8.8.8', '93.184.216.34', '2606:4700:4700::1111']:
            self.assertTrue(media.is_public_address(address), address)

    def test_hostile_redirect_rejected_by_real_redirect_handler(self):
        handler = media.PublicRedirectHandler()
        request = media.urllib.request.Request('https://example.com/video.mp4')
        for url in ['http://169.254.169.254/latest/meta-data/', 'file:///etc/passwd', 'https://[::1]/v.mp4', 'https://user:pass@example.com/v.mp4']:
            with self.assertRaises(media.BoundaryError):
                handler.redirect_request(request, None, 302, 'Found', {}, url)
        redirected = handler.redirect_request(request, None, 302, 'Found', {}, 'https://cdn.example.com/v.mp4')
        self.assertEqual(redirected.full_url, 'https://cdn.example.com/v.mp4')

    def test_download_limits_unknown_length_stream_and_never_keeps_partial(self):
        class Response(io.BytesIO):
            headers = {}
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'video.mp4'
            with self.assertRaises(media.TooLarge):
                media.write_response(Response(b'x' * 64), output, 32)
            self.assertFalse(output.exists())

    def test_extraction_options_cannot_load_ambient_state_or_subprocesses(self):
        options = media.extractor_options(50 * 1024 * 1024, 1800)
        self.assertEqual(options['proxy'], '')
        self.assertFalse(options['usenetrc'])
        self.assertFalse(options['cachedir'])
        self.assertIsNone(options['cookiefile'])
        self.assertEqual(options['js_runtimes'], {})
        self.assertFalse(options['enable_file_urls'])
        self.assertEqual(options['external_downloader'], {})
        self.assertEqual(options['fixup'], 'never')

    def test_playlist_live_and_duration_rejected_before_download(self):
        for info in [{'_type': 'playlist'}, {'entries': []}, {'is_live': True}, {'live_status': 'is_upcoming'}, {'duration': 1801}]:
            with self.assertRaises(media.Unsupported):
                media.validate_info(info, 1800)


if __name__ == '__main__':
    unittest.main()
