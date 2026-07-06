import sys
from pathlib import Path

# Makes `import app`, `from config import ...`, etc. work regardless of where pytest is
# invoked from (repo root or proxy/), without needing package __init__.py files.
sys.path.insert(0, str(Path(__file__).parent))
