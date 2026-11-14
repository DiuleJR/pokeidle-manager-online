import unittest
from unittest.mock import patch

from session_stats import SessionStore, ShinyTracker, hunt_is_outland


class ShinyTests(unittest.TestCase):
    def test_failed_ball_then_flee_and_slot_reuse(self):
        tracker = ShinyTracker()
        tracker.handle({"k": "morte", "quem": "selvagem", "slot": 2, "nome": "Pupitar"})
        self.assertEqual(tracker.handle({"k": "bola", "slot": 2, "shiny": True, "sucesso": False}), (True, False))
        self.assertEqual(tracker.handle({"k": "fugiu", "nome": "Pupitar", "shiny": True}), (False, False))
        tracker.handle({"k": "morte", "quem": "selvagem", "slot": 2, "nome": "Pupitar"})
        self.assertEqual(tracker.handle({"k": "bola", "slot": 2, "shiny": True, "sucesso": True}), (True, True))
        self.assertEqual(tracker.handle({"k": "bola", "slot": 2, "shiny": True, "sucesso": True}), (False, False))
        self.assertEqual((tracker.seen, tracker.captured), (2, 1))

    def test_unrelated_flee_and_repeated_attempts(self):
        tracker = ShinyTracker()
        tracker.handle({"k": "morte", "quem": "selvagem", "slot": 1, "nome": "Pupitar"})
        tracker.handle({"k": "bola", "slot": 1, "shiny": True, "sucesso": False})
        self.assertEqual(tracker.handle({"k": "fugiu", "nome": "Ralts", "shiny": True}), (True, False))
        self.assertEqual(tracker.handle({"k": "bola", "slot": 1, "shiny": True, "sucesso": True}), (False, True))
        self.assertEqual((tracker.seen, tracker.captured), (2, 1))

    def test_visibility_tracks_region_and_unknown_hunts(self):
        hunts = [{"slug": "one", "area": "kanto"},
                 {"slug": "two", "area": "outland", "regiao": "outland2"},
                 {"slug": "three", "area": "orre", "regiao": "outland3"}]
        self.assertIs(hunt_is_outland(hunts, "one"), False)
        self.assertIs(hunt_is_outland(hunts, "two"), True)
        self.assertIs(hunt_is_outland(hunts, "three"), True)
        self.assertIsNone(hunt_is_outland(hunts, "unknown"))
        self.assertIsNone(hunt_is_outland([{"slug": "x"}], "x"))

    def test_persistence_and_legacy_session(self):
        store = SessionStore("missing-session-file.json")
        with patch.object(store, "_write"):
            store.save("acc1", 1, {"key": 2}, {"seen": 3, "captured": 1})
            self.assertEqual(store.get("acc1")["shinies"], {"seen": 3, "captured": 1})
            store.save("acc2", 1, {})
            self.assertEqual(store.get("acc2")["shinies"], {})



if __name__ == "__main__":
    unittest.main()
