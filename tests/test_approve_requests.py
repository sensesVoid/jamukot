import importlib.util
import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("approve_requests", ROOT / "scripts" / "approve_requests.py")
ar = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(ar)


class TestNormalization(unittest.TestCase):
    def test_brackets_feat_case_and_the(self):
        self.assertEqual(
            ar.normalize_key("Song (Official Video)", "The Artist feat. Someone"),
            ar.normalize_key("song", "Artist"),
        )

    def test_different_songs_differ(self):
        self.assertNotEqual(ar.normalize_key("Song A", "Artist"), ar.normalize_key("Song B", "Artist"))

    def test_unicode_is_folded(self):
        self.assertEqual(ar.normalize_key("Café", "Beyoncé"), ar.normalize_key("Cafe", "Beyonce"))


class TestDuplicates(unittest.TestCase):
    def test_matches_existing_track_by_key(self):
        tracks = [{"title": "Song", "artist": "Artist"}]
        self.assertIsNotNone(ar.find_duplicate("Song (Lyrics)", "Artist", None, tracks))

    def test_matches_youtube_id(self):
        tracks = [{"title": "Other", "artist": "Person", "youtube_id": "dQw4w9WgXcQ"}]
        self.assertIsNotNone(ar.find_duplicate("New", "New", "dQw4w9WgXcQ", tracks))

    def test_returns_none_for_new_song(self):
        self.assertIsNone(ar.find_duplicate("New", "New", "dQw4w9WgXcQ", []))


class TestFilename(unittest.TestCase):
    def test_suffixes_when_name_exists(self):
        tracks = [{"url": "https://x.test/Artist%20-%20Song.mp3"}]
        self.assertEqual(ar.unique_filename("Artist - Song", tracks), "Artist - Song (2).mp3")

    def test_plain_name_when_unique(self):
        self.assertEqual(ar.unique_filename("Artist - Song", []), "Artist - Song.mp3")


class TestBatch(unittest.TestCase):
    def test_duplicate_and_failure_do_not_block_others(self):
        requests = [
            {"title": "Duplicate", "artist": "A"},
            {"title": "Fails", "artist": "B"},
            {"title": "Good", "artist": "C"},
        ]
        tracks_data = {"tracks": []}

        def processor(req, data):
            if req["title"] == "Duplicate":
                return "duplicate"
            if req["title"] == "Fails":
                raise RuntimeError("download failed")
            return "added"

        result = ar.run_batch(requests, tracks_data, processor)
        self.assertEqual(result["added"], 1)
        self.assertEqual(result["duplicate"], 1)
        self.assertEqual(result["failed"], 1)
        self.assertEqual([r["title"] for r in requests], ["Fails"])
        self.assertEqual(requests[0]["attempts"], 1)
        self.assertIn("download failed", requests[0]["last_error"])

    def test_storage_limit_stops_and_keeps_remaining(self):
        requests = [{"title": "A"}, {"title": "B"}]

        def processor(req, data):
            raise ar.StorageLimitError("cap")

        result = ar.run_batch(requests, {"tracks": []}, processor)
        self.assertTrue(result["stopped"])
        self.assertEqual(len(requests), 2)

    def test_capacity(self):
        ar.check_capacity(0, 10, limit=100)
        with self.assertRaises(ar.StorageLimitError):
            ar.check_capacity(95, 10, limit=100)


if __name__ == "__main__":
    unittest.main()
