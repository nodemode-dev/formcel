import os
import sys

import pytest

from app.services import pysand

needs_posix = pytest.mark.skipif(os.name != "posix", reason="Python cells run on Linux and macOS only")
needs_pandas = pytest.mark.skipif(not pysand.pandas_ready(), reason="pandas is not installed")

REFUSED = [
    "repr(calendar.sys)",
    "repr(statistics.sys)",
    "repr(textwrap.re)",
    "from calendar import sys\nrepr(sys)",
    "operator.attrgetter('real')(1)",
    "operator.methodcaller('bit_length')(1)",
    "string.Formatter().format('{0}', 1)",
    "def g():\n    yield w.gi_frame.f_back\nw = g()\nrepr(next(w))",
    "def g():\n    yield 1\nrepr(g().gi_code)",
]

REFUSED_WITH_PANDAS = [
    "repr(pd.io.common.os)",
    "import pandas.io.common as c\nrepr(c.os)",
    "repr(np.ctypeslib)",
    "import numpy.ctypeslib\n1",
    "from numpy.lib import stride_tricks\n1",
    "repr(pd.core)",
    "repr(pd.eval('x.__class__', local_dict={'x': 1}, engine='python'))",
    "repr(pd.DataFrame({'a': [1]}).query('@calendar.isleap.__globals__ is None'))",
    f"len(pd.read_csv({os.path.realpath(sys.executable)!r}, sep='|', header=None))",
]


@needs_posix
@pytest.mark.parametrize("source", REFUSED, ids=[f"case{i + 1}" for i in range(len(REFUSED))])
def test_this_handler_source_is_refused(source):
    with pytest.raises(pysand.PyError, match="not available|cannot import name"):
        pysand.run(source, [], handler=True)


@needs_posix
@needs_pandas
@pytest.mark.parametrize("source", REFUSED_WITH_PANDAS, ids=[f"case{i + 1}" for i in range(len(REFUSED_WITH_PANDAS))])
def test_this_handler_source_is_refused_with_pandas(source):
    with pytest.raises(pysand.PyError, match="not available|cannot import name"):
        pysand.run(source, [], handler=True)


@needs_posix
def test_ordinary_handler_imports_still_work():
    out = pysand.run("import collections.abc\nimport json, re\nfrom datetime import date\nimport math\n[isinstance([], collections.abc.Sequence), json.dumps(re.findall(r'\\d+', 'a1b22')), str(date(2026, 11, 18)), math.sqrt(16)]", [], handler=True)
    assert out["value"] == [[True], ['["1", "22"]'], ["2026-11-18"], [4.0]]


@needs_posix
@needs_pandas
def test_ordinary_pandas_handlers_still_work():
    code = "from pandas.api.types import is_numeric_dtype\nimport numpy.linalg as la\ndf = pd.DataFrame({'a': [1, 2]})\n[is_numeric_dtype(df['a']), float(la.norm([3, 4])), float(df.eval('a * 2').sum()), len(df.query('a > 1')), [r.a for r in df.itertuples()]]"
    assert pysand.run(code, [], handler=True)["value"] == [[True], [5.0], [6.0], [1], ['[1, 2]']]
