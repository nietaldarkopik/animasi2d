import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from card_builder.cli import main  # noqa: E402

sys.exit(main())
