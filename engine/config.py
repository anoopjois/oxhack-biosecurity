"""Every constant used by the engine's maths and the synthetic data generator.

Nothing in engine/ may hardcode a number that lives here. All windows are in DAYS.
Notation follows CLAUDE.md: x = log wastewater (3-day mean), ER = ER wait (minutes),
M = mobility / 100, t = the as-of day.
"""

from pathlib import Path

# --------------------------------------------------------------------------- #
# Zones
# --------------------------------------------------------------------------- #
ZONES_CSV = Path(__file__).with_name("zones.csv")

# --------------------------------------------------------------------------- #
# Preprocessing
# --------------------------------------------------------------------------- #
# Wastewater readings below this are indistinguishable from zero, so we floor them
# here before taking logs (log(0) would be -inf). Units: viral copies per litre.
DETECTION_LIMIT = 1_000.0

# x(t) = log(mean of wastewater over days t-2, t-1, t): a 3-day trailing mean.
SMOOTH_WINDOW_DAYS = 3

# --------------------------------------------------------------------------- #
# Baseline: per-zone mean and std over days t-17 .. t-4 (inclusive)
# --------------------------------------------------------------------------- #
# The 4-day gap means a rise that started in the last few days can't drag its own
# baseline upwards and hide itself.
BASELINE_START_LAG_DAYS = 17  # oldest day in the window is t - 17
BASELINE_END_LAG_DAYS = 4     # newest day in the window is t - 4

# Days of data needed before a zone can be scored: x at t-17 needs a full 3-day mean,
# so the earliest raw reading used is t-17-(3-1) = t-19, i.e. 20 days in total.
MIN_HISTORY_DAYS = BASELINE_START_LAG_DAYS + SMOOTH_WINDOW_DAYS

# --------------------------------------------------------------------------- #
# Noise levels (shared by generator and engine)
# --------------------------------------------------------------------------- #
# Daily wastewater = true load * exp(eps), eps ~ Normal(0, WW_NOISE_SIGMA).
WW_NOISE_SIGMA = 0.3

# ER wait noise: Normal(0, ER_NOISE_SD) minutes, independent each day.
ER_NOISE_SD = 5.0

# z-score std floors equal the known noise, so a lucky, unusually calm baseline
# can't turn a small wobble into a huge z.
#   For x, averaging 3 independent log-noise terms divides the SD by sqrt(3).
X_STD_FLOOR = WW_NOISE_SIGMA / SMOOTH_WINDOW_DAYS ** 0.5
ER_STD_FLOOR = ER_NOISE_SD

# --------------------------------------------------------------------------- #
# Score: s(z) = 1 / (1 + exp(-(z - LOGISTIC_CENTRE)))
#        score = 100 * (W_WASTEWATER*s_W + W_ER*s_E + W_MOBILITY*M), clipped to [0, 100]
# --------------------------------------------------------------------------- #
LOGISTIC_CENTRE = 2.0  # s = 0.5 at z = 2, i.e. "two standard deviations above normal"

W_WASTEWATER = 0.50
W_ER = 0.35
W_MOBILITY = 0.15

SCORE_MIN = 0.0
SCORE_MAX = 100.0

# --------------------------------------------------------------------------- #
# Forecast
# --------------------------------------------------------------------------- #
# OLS of raw daily log wastewater on day over the last 7 days gives r_hat (per day)
# and its standard error.
FORECAST_FIT_DAYS = 7
FORECAST_HORIZON_DAYS = 2  # we project to t + 2

# ER responds to wastewater with a lag of L days (people get sick, then go to A&E).
ER_LAG_DAYS = 4

# ER_hat(t+2) = mu_E + BETA_ER * (x(t+2-L) - mu_x). Calibrated to match the generator.
BETA_ER = 20.0

# "Significantly growing" means r_hat - SE_MULTIPLIER * SE > 0. With 7 points (5
# degrees of freedom) this is roughly a one-sided 5% test.
SE_MULTIPLIER = 2.0

# --------------------------------------------------------------------------- #
# Status thresholds
# --------------------------------------------------------------------------- #
CRITICAL_ENTER_SCORE = 80.0  # projected_score >= this (plus significant growth)
CRITICAL_EXIT_SCORE = 70.0   # hysteresis: stay CRITICAL until current score < this
ELEVATED_SCORE = 40.0        # current score > this means ELEVATED

# --------------------------------------------------------------------------- #
# Synthetic data generator
# --------------------------------------------------------------------------- #
# Per-zone baseline wastewater load, drawn log-uniformly from this range (copies/L).
WW_BASELINE_RANGE = (50_000.0, 500_000.0)

# Per-zone baseline ER wait (minutes), drawn uniformly.
ER_BASELINE_RANGE = (30.0, 90.0)

# True coupling in the generator:
#   ER(t) = ER_base + ER_WW_COUPLING * (log W_true(t-L) - log W_base) + noise
ER_WW_COUPLING = 20.0

# Mobility density index (0-100), stable per zone, drawn uniformly.
MOBILITY_RANGE = (20.0, 80.0)

# Default outbreak growth rate r (per day): load doubles every ln2/0.4 ≈ 1.7 days.
DEFAULT_OUTBREAK_R = 0.4
