from engine import config


def test_score_weights_sum_to_one():
    total = config.W_WASTEWATER + config.W_ER + config.W_MOBILITY
    assert abs(total - 1.0) < 1e-12


def test_thresholds_are_ordered():
    assert config.SCORE_MIN < config.ELEVATED_SCORE < config.CRITICAL_EXIT_SCORE
    assert config.CRITICAL_EXIT_SCORE < config.CRITICAL_ENTER_SCORE <= config.SCORE_MAX


def test_baseline_window_is_valid():
    assert config.BASELINE_START_LAG_DAYS > config.BASELINE_END_LAG_DAYS > 0
    assert config.MIN_HISTORY_DAYS > config.FORECAST_FIT_DAYS


def test_std_floors_match_noise():
    assert abs(config.X_STD_FLOOR - config.WW_NOISE_SIGMA / 3 ** 0.5) < 1e-12
    assert config.ER_STD_FLOOR == config.ER_NOISE_SD
