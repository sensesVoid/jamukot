import json, urllib.request, urllib.parse
d=json.load(open('data/tracks.json',encoding='utf-8'))
for t in d['tracks']:
    url='https://lrclib.net/api/get?artist_name='+urllib.parse.quote(t['artist'])+'&track_name='+urllib.parse.quote(t['title'])
    try:
        r=urllib.request.urlopen(url)
        data=json.loads(r.read())
        synced = bool(data.get('syncedLyrics'))
        dur=data.get('duration')
        print(f"{t['artist']} - {t['title']}: synced={synced} lrclib_dur={dur} audio_dur={t['duration']}")
    except Exception as e:
        print(f"{t['artist']} - {t['title']}: ERROR {e}")
