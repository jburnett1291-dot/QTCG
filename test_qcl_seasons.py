import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from qcl_seasons import (  # noqa: E402
    _next_season,
    column_letter,
    csv_text,
    rows_as_dicts,
    season_label,
    slugify,
    public_csv_url,
    SeasonError,
    validate_season_rows,
)


class SeasonHelpersTests(unittest.TestCase):
    def setUp(self):
        self.headers = [
            "Player/Team",
            "Team Name",
            "Type",
            "Game_ID",
            "Season",
            "Game Edition",
        ]
        self.active = {
            "game_edition": "2K26",
            "season_number": 1,
            "season_label": "QCL Season One",
            "spreadsheet_id": "sheet-id",
            "sheet_tab": "Raw Data",
            "sheet_gid": 0,
        }

    def test_season_labels_and_slugs(self):
        self.assertEqual(season_label(1), "QCL Season One")
        self.assertEqual(season_label(21), "QCL Season 21")
        self.assertEqual(slugify("QCL Season One"), "qcl-season-one")

    def test_column_letters(self):
        self.assertEqual(column_letter(0), "A")
        self.assertEqual(column_letter(25), "Z")
        self.assertEqual(column_letter(28), "AC")

    def test_rows_as_dicts_skips_blank_rows_and_fills_missing_cells(self):
        headers, rows = rows_as_dicts(
            [
                self.headers,
                ["Lynx", "Cats", "Player", "g-1", "1", "2K26"],
                [],
                ["Owls", "Owls", "Player", "g-2", "1"],
            ]
        )
        self.assertEqual(headers, self.headers)
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[1]["Game Edition"], "")

    def test_csv_quotes_commas_and_quotes(self):
        content = csv_text(self.headers, [{"Player/Team": 'A, "B"'}])
        self.assertIn('"A, ""B"""', content)

    def test_public_csv_url_uses_only_the_raw_data_gid(self):
        self.assertEqual(
            public_csv_url(self.active),
            "https://docs.google.com/spreadsheets/d/sheet-id/export?format=csv&gid=0",
        )

    def test_validation_accepts_active_season(self):
        rows = [
            {
                "Player/Team": "Lynx",
                "Team Name": "Cats",
                "Type": "Player",
                "Game_ID": "game-1",
                "Season": "1",
                "Game Edition": "2K26",
            }
        ]
        self.assertEqual(
            validate_season_rows(self.headers, rows, self.active), ("2K26", 1)
        )

    def test_validation_rejects_edition_mismatch(self):
        rows = [
            {
                "Player/Team": "Lynx",
                "Team Name": "Cats",
                "Type": "Player",
                "Game_ID": "game-1",
                "Season": "1",
                "Game Edition": "2K27",
            }
        ]
        with self.assertRaisesRegex(SeasonError, "Game Edition"):
            validate_season_rows(self.headers, rows, self.active)

    def test_validation_preserves_rows_with_blank_player_team_or_type(self):
        row = {
            "Player/Team": "",
            "Team Name": "Cats",
            "Type": "",
            "Game_ID": "game-1",
            "Season": "1",
            "Game Edition": "2K26",
        }
        self.assertEqual(
            validate_season_rows(self.headers, [row], self.active), ("2K26", 1)
        )

    def test_next_season_increments_within_current_edition(self):
        next_season = _next_season(self.active)
        self.assertEqual(next_season["game_edition"], "2K26")
        self.assertEqual(next_season["season_number"], 2)
        self.assertEqual(next_season["season_label"], "QCL Season Two")
        self.assertEqual(next_season["spreadsheet_id"], "sheet-id")
        self.assertEqual(next_season["sheet_gid"], 0)

    def test_era_and_game_edition_remain_distinct(self):
        headers = self.headers + ["Era"]
        row = {
            "Player/Team": "Lynx",
            "Team Name": "Cats",
            "Type": "Player",
            "Game_ID": "game-1",
            "Season": "1",
            "Game Edition": "2K26",
            "Era": "QCL",
        }
        self.assertEqual(validate_season_rows(headers, [row], self.active), ("2K26", 1))


if __name__ == "__main__":
    unittest.main()