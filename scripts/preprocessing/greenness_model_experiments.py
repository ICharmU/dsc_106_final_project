import json
import numpy as np
from pathlib import Path

# ---------------------------------------------------------
# 1. CONFIG: where your preprocessed grid JSONs live
# ---------------------------------------------------------

# Adjust these if your folder structure changes
CITY_CONFIGS = {
    "tokyo": {
        "label": "Tokyo",
        "grid_path": Path("data/tokyo/tokyo_grid.json"),
    },
    "london": {
        "label": "London",
        "grid_path": Path("data/london/london_grid.json"),
    },
    "nyc": {
        "label": "New York City",
        "grid_path": Path("data/nyc/nyc_grid.json"),
    },
    "sandiego": {
        "label": "San Diego County",
        "grid_path": Path("data/san-diego/sandiego_grid.json"),
    },
}

# Where to store response curves for later use in JS
MODELS_OUT_PATH = Path("data/models/ndvi_lst_response_curves.json")

# ---------------------------------------------------------
# 2. Utilities: loading & basic stats
# ---------------------------------------------------------

def load_city_grid(grid_path):
    """
    Load flattened pixel-level arrays from one *_grid.json.
    Returns: ndvi, lst_day, lst_night, ward_ids (all 1D np arrays).
    """
    with open(grid_path, "r", encoding="utf-8") as f:
        g = json.load(f)

    def arr(key, dtype=float):
        return np.array(g[key], dtype=dtype)

    ndvi = arr("ndvi", dtype=float)
    lst_day = arr("lst_day_C", dtype=float)
    lst_night = arr("lst_night_C", dtype=float)
    ward_ids = arr("ward_ids", dtype=int)

    # Keep only pixels inside wards and with finite values
    mask = (
        (ward_ids > 0)
        & np.isfinite(ndvi)
        & np.isfinite(lst_day)
        & np.isfinite(lst_night)
    )

    ndvi = ndvi[mask]
    lst_day = lst_day[mask]
    lst_night = lst_night[mask]

    return ndvi, lst_day, lst_night


def corr_safe(x, y):
    """Correlation helper that returns NaN if degenerate."""
    if len(x) < 3:
        return np.nan
    if np.std(x) == 0 or np.std(y) == 0:
        return np.nan
    return float(np.corrcoef(x, y)[0, 1])

# ---------------------------------------------------------
# 3. Binned response curves
# ---------------------------------------------------------

def build_response_curve(x, y, bins, min_count=50):
    """
    Build a 1D response curve by binning x and averaging y.
    x: NDVI values
    y: LST values
    bins: array of bin edges
    min_count: minimum pixels needed for a bin to be kept

    Returns:
        xs: list of mean NDVI per bin
        ys: list of mean LST per bin
    """
    x = np.asarray(x, dtype=float)
    y = np.asarray(y, dtype=float)

    digitized = np.digitize(x, bins)
    xs, ys = [], []

    for i in range(1, len(bins)):
        mask = digitized == i
        if mask.sum() < min_count:
            continue

        x_bin = x[mask]
        y_bin = y[mask]

        xs.append(float(np.mean(x_bin)))
        ys.append(float(np.mean(y_bin)))

    if not xs:
        return [], []

    # ensure sorted by x
    order = np.argsort(xs)
    xs = [xs[i] for i in order]
    ys = [ys[i] for i in order]
    return xs, ys


def moving_average(values, window=3):
    """Simple moving average smoother for curve y-values."""
    if window <= 1 or len(values) <= 1:
        return values

    vals = np.asarray(values, dtype=float)
    half = window // 2
    out = []

    for i in range(len(vals)):
        i0 = max(0, i - half)
        i1 = min(len(vals), i + half + 1)
        out.append(float(np.mean(vals[i0:i1])))

    return out

# ---------------------------------------------------------
# 4. Optional: pooled linear / ridge model
# ---------------------------------------------------------

def make_city_dummy_matrix(city_ids, all_city_keys):
    """
    Create dummy variables for cities (no intercept here).
    city_ids: list of city key strings (e.g. "tokyo", "london")
    all_city_keys: ordered list of all city keys used for dummy columns.

    Returns:
        dummies: (n_samples, n_cities) matrix
    """
    n = len(city_ids)
    k = len(all_city_keys)
    dummies = np.zeros((n, k), dtype=float)
    key_to_col = {k_: i for i, k_ in enumerate(all_city_keys)}

    for i, cid in enumerate(city_ids):
        j = key_to_col[cid]
        dummies[i, j] = 1.0

    return dummies


def fit_pooled_linear_model(city_pixel_data, target="day"):
    """
    Fit a pooled linear model:

        LST = intercept + beta_ndvi * NDVI + city_dummies + error

    city_pixel_data: dict city_id -> dict with keys ndvi, lst_day, lst_night.

    target: "day" or "night"

    Returns:
        coeffs: dict describing fitted parameters (ndvi slope, per-city intercepts)
    """
    # Concatenate all cities
    all_city_keys = list(city_pixel_data.keys())

    ndvi_all = []
    lst_all = []
    city_ids_all = []

    for cid, d in city_pixel_data.items():
        ndvi = d["ndvi"]
        if target == "day":
            lst = d["lst_day"]
        else:
            lst = d["lst_night"]

        ndvi_all.append(ndvi)
        lst_all.append(lst)
        city_ids_all.extend([cid] * len(ndvi))

    ndvi_all = np.concatenate(ndvi_all)
    lst_all = np.concatenate(lst_all)
    city_ids_all = np.array(city_ids_all, dtype=object)

    # Design matrix: [1, NDVI, city dummies]
    n = len(ndvi_all)
    ones = np.ones((n, 1), dtype=float)
    ndvi_col = ndvi_all.reshape(-1, 1)
    city_dummies = make_city_dummy_matrix(city_ids_all, all_city_keys)

    X = np.concatenate([ones, ndvi_col, city_dummies], axis=1)
    y = lst_all.reshape(-1, 1)

    # Solve least squares: beta = (X^T X)^(-1) X^T y
    beta, *_ = np.linalg.lstsq(X, y, rcond=None)
    beta = beta.flatten()

    intercept = float(beta[0])
    beta_ndvi = float(beta[1])
    city_offsets = beta[2:]  # one per city key, in all_city_keys order

    coeffs = {
        "target": target,
        "ndvi_slope": beta_ndvi,
        "global_intercept": intercept,
        "city_intercepts": {
            cid: float(intercept + city_offsets[i])
            for i, cid in enumerate(all_city_keys)
        },
        "cities_order": all_city_keys,
    }
    return coeffs

# ---------------------------------------------------------
# 5. Main experiment routine
# ---------------------------------------------------------

def run_experiments():
    # 1) Load per-city pixel data
    city_pixel_data = {}

    for cid, cfg in CITY_CONFIGS.items():
        path = cfg["grid_path"]
        if not path.exists():
            print(f"[WARN] Grid file not found for {cid}: {path}")
            continue

        ndvi, lst_day, lst_night = load_city_grid(path)
        city_pixel_data[cid] = {
            "ndvi": ndvi,
            "lst_day": lst_day,
            "lst_night": lst_night,
        }

        print(f"Loaded {cid} ({cfg['label']}): {len(ndvi)} pixels inside wards")

    # 2) Per-city summary stats + response curves
    bins = np.arange(-0.2, 1.05, 0.05)  # NDVI ~ [-0.2, 1.0] from your preprocessing
    per_city_models = {}

    print("\n=== Per-city NDVI–LST stats ===")
    for cid, data in city_pixel_data.items():
        ndvi = data["ndvi"]
        lst_day = data["lst_day"]
        lst_night = data["lst_night"]

        r_day = corr_safe(ndvi, lst_day)
        r_night = corr_safe(ndvi, lst_night)

        print(f"\nCity: {CITY_CONFIGS[cid]['label']} ({cid})")
        print(f"  N pixels:        {len(ndvi)}")
        print(f"  Corr(NDVI, LST day):   {r_day: .3f}")
        print(f"  Corr(NDVI, LST night): {r_night: .3f}")

        # curves
        xs_day, ys_day = build_response_curve(ndvi, lst_day, bins, min_count=50)
        xs_night, ys_night = build_response_curve(ndvi, lst_night, bins, min_count=50)

        ys_day_smooth = moving_average(ys_day, window=3)
        ys_night_smooth = moving_average(ys_night, window=3)

        # quick sense of "delta" for +0.1 NDVI at median NDVI
        if xs_day:
            ndvi_med = float(np.median(ndvi))
            # find nearest curve point to median
            idx_closest = int(np.argmin(np.abs(np.array(xs_day) - ndvi_med)))
            ndvi_ref = xs_day[idx_closest]
            # approximate +0.1 step on curve
            ndvi_target = ndvi_ref + 0.1
            # bound within curve domain
            ndvi_target = max(xs_day[0], min(xs_day[-1], ndvi_target))

            # simple linear interpolation on the smoothed curve
            def interp(xs, ys, x):
                xs_arr = np.array(xs)
                ys_arr = np.array(ys)
                if x <= xs_arr[0]: return float(ys_arr[0])
                if x >= xs_arr[-1]: return float(ys_arr[-1])
                j = np.searchsorted(xs_arr, x) - 1
                j = max(0, min(j, len(xs_arr) - 2))
                x0, x1 = xs_arr[j], xs_arr[j+1]
                y0, y1 = ys_arr[j], ys_arr[j+1]
                t = (x - x0) / (x1 - x0)
                return float(y0 + t * (y1 - y0))

            lst_day_ref = interp(xs_day, ys_day_smooth, ndvi_ref)
            lst_day_new = interp(xs_day, ys_day_smooth, ndvi_target)
            delta_day = lst_day_new - lst_day_ref

            lst_night_ref = interp(xs_night, ys_night_smooth, ndvi_ref)
            lst_night_new = interp(xs_night, ys_night_smooth, ndvi_target)
            delta_night = lst_night_new - lst_night_ref

            print(f"  Example Δ for +0.10 NDVI at NDVI≈{ndvi_ref:.2f}:")
            print(f"    Daytime LST:   {delta_day:+.2f} °C")
            print(f"    Nighttime LST: {delta_night:+.2f} °C")

        per_city_models[cid] = {
            "city": CITY_CONFIGS[cid]["label"],
            "ndvi_corr_day": r_day,
            "ndvi_corr_night": r_night,
            "ndvi_to_lst": {
                "day": {
                    "ndvi": xs_day,
                    "lst": ys_day_smooth,
                },
                "night": {
                    "ndvi": xs_night,
                    "lst": ys_night_smooth,
                },
            },
        }

    # 3) Optional: pooled linear model across cities
    if city_pixel_data:
        print("\n=== Pooled linear models (NDVI + city dummies) ===")
        pooled_day = fit_pooled_linear_model(city_pixel_data, target="day")
        pooled_night = fit_pooled_linear_model(city_pixel_data, target="night")

        print("\nDaytime model:")
        print(f"  Global NDVI slope: {pooled_day['ndvi_slope']:.3f} °C per NDVI")
        for cid, intercept in pooled_day["city_intercepts"].items():
            print(f"  City intercept ({CITY_CONFIGS[cid]['label']}): {intercept:.2f} °C")

        print("\nNighttime model:")
        print(f"  Global NDVI slope: {pooled_night['ndvi_slope']:.3f} °C per NDVI")
        for cid, intercept in pooled_night["city_intercepts"].items():
            print(f"  City intercept ({CITY_CONFIGS[cid]['label']}): {intercept:.2f} °C")

    # 4) Save per-city response curves to JSON for the front-end
    models_out = {
        "per_city_response_curves": per_city_models,
        "note": (
            "Curves are NDVI-binned & smoothed LST averages per city. "
            "Use these for the what-if greenness simulator."
        ),
    }

    MODELS_OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(MODELS_OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(models_out, f, indent=2)

    print(f"\nWrote response curve models to {MODELS_OUT_PATH.resolve()}")


if __name__ == "__main__":
    run_experiments()
