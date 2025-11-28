import json
import numpy as np
import tifffile
import imagecodecs
import shapely
from shapely.geometry import shape, Point

NDVI_TIF = "data/san-diego/sandiego_NDVI.tif"
LST_TIF  = "data/san-diego/sandiego_LST.tif"   # exported with LST_Day & LST_Night
NYC_JSON = "data/san-diego/boundaries/Council_Districts.geojson"
MIN_LON, MIN_LAT, MAX_LON, MAX_LAT = -117.6, 32.53, -116.08, 33.49

GRID_OUT   = "data/san-diego/sandiego_grid.json"
BOROUGHS_OUT  = "data/san-diego/sandiego_boroughs.json"

def gap_fill(arr, iterations=5, mask=None):
    """
    Fill NaNs in arr using the mean of 4 neighbours.
    If mask is provided, only fill inside mask == True.
    """
    arr = arr.copy()
    h, w = arr.shape
    if mask is None:
        mask = np.ones_like(arr, dtype=bool)

    for _ in range(iterations):
        new = arr.copy()
        for r in range(h):
            for c in range(w):
                if not mask[r, c] or not np.isnan(arr[r, c]):
                    continue

                neigh = []
                if r > 0   and mask[r-1, c] and not np.isnan(arr[r-1, c]): neigh.append(arr[r-1, c])
                if r < h-1 and mask[r+1, c] and not np.isnan(arr[r+1, c]): neigh.append(arr[r+1, c])
                if c > 0   and mask[r, c-1] and not np.isnan(arr[r, c-1]): neigh.append(arr[r, c-1])
                if c < w-1 and mask[r, c+1] and not np.isnan(arr[r, c+1]): neigh.append(arr[r, c+1])

                if neigh:
                    new[r, c] = float(np.mean(neigh))
        arr = new
    return arr


def fill_remaining(arr, inside_mask):
    vals = arr[inside_mask & ~np.isnan(arr)]
    global_mean = float(np.mean(vals))
    out = arr.copy()
    out[np.isnan(out)] = global_mean
    return out


# 1. Load NDVI (single-band)
ndvi_raw = tifffile.imread(NDVI_TIF)  # (H,W) or (1,H,W)
if ndvi_raw.ndim == 3:
    ndvi_raw = ndvi_raw[0]

H, W = ndvi_raw.shape

ndvi = ndvi_raw.astype("float32")
ndvi_nodata = (ndvi <= -2000) | (ndvi == 0)
ndvi = ndvi * 0.0001        # now about [-0.2, 1.0]
ndvi[ndvi_nodata] = np.nan


# 2. Load LST (day + night)
lst_raw = tifffile.imread(LST_TIF)

if lst_raw.ndim == 3:
    if lst_raw.shape == (H, W, 2):
        # (H, W, bands)
        lst_day_raw = lst_raw[:, :, 0].astype("float32")
        lst_night_raw = lst_raw[:, :, 1].astype("float32")
    elif lst_raw.shape[0] == 2 and lst_raw.shape[1] == H and lst_raw.shape[2] == W:
        # (bands, H, W)
        lst_day_raw = lst_raw[0].astype("float32")
        lst_night_raw = lst_raw[1].astype("float32")
    else:
        raise ValueError(
            f"Unexpected LST shape {lst_raw.shape}; "
            f"cannot align with NDVI shape {(H, W)}"
        )
else:
    raise ValueError(f"Expected 3D LST GeoTIFF with 2 bands; got shape {lst_raw.shape}")

# MOD11A2: scale 0.02, Kelvin
scale_LST = 0.02
lst_day_K = lst_day_raw * scale_LST
lst_night_K = lst_night_raw * scale_LST

mask_invalid_day = (lst_day_raw <= 0)
mask_invalid_night = (lst_night_raw <= 0)

lst_day_K[mask_invalid_day] = np.nan
lst_night_K[mask_invalid_night] = np.nan

# Convert to °C
lst_day = lst_day_K - 273.15
lst_night = lst_night_K - 273.15


# 3. Rasterize wards → ward_ids grid
with open(NYC_JSON, "r", encoding="utf-8") as f:
    gj = json.load(f)

features = gj["features"]
geoms = [shapely.make_valid(shape(feat["geometry"])) for feat in features]

borough_ids = np.zeros((H, W), dtype="int32")
borough_names = {}
borough_codes = {}

for idx, feat in enumerate(features, start=1):
    props = feat.get("properties", {})
    borough_names[idx] = props.get("BoroName")
    borough_codes[idx] = props.get("BoroCode")

# assign each pixel to a ward by its centre point
for r in range(H):
    lat = MIN_LAT + ((r + 0.5) * (MAX_LAT - MIN_LAT) / H)
    for c in range(W):
        lon = MIN_LON + ((c + 0.5) * (MAX_LON - MIN_LON) / W)
        pt = Point(lon, lat)
        for i, geom in enumerate(geoms, start=1):
            if geom.contains(pt):
                borough_ids[r, c] = i
                break

inside_mask = borough_ids > 0
# 4. Gap-fill NDVI & LST *inside wards*
ndvi_filled = gap_fill(ndvi, iterations=8, mask=inside_mask)
lst_day_filled = gap_fill(lst_day, iterations=8, mask=inside_mask)
lst_night_filled = gap_fill(lst_night, iterations=8, mask=inside_mask)

ndvi_filled = fill_remaining(ndvi_filled, inside_mask)
lst_day_filled = fill_remaining(lst_day_filled, inside_mask)
lst_night_filled = fill_remaining(lst_night_filled, inside_mask)

# grids for JSON rendering (outside wards = 0)
ndvi_grid = ndvi_filled.copy()
lst_day_grid = lst_day_filled.copy()
lst_night_grid = lst_night_filled.copy()

ndvi_grid[~inside_mask] = 0.0
lst_day_grid[~inside_mask] = 0.0
lst_night_grid[~inside_mask] = 0.0

# global min/max within wards only
ndvi_min = float(np.min(ndvi_filled[inside_mask]))
ndvi_max = float(np.max(ndvi_filled[inside_mask]))
lst_day_min = float(np.min(lst_day_filled[inside_mask]))
lst_day_max = float(np.max(lst_day_filled[inside_mask]))
lst_night_min = float(np.min(lst_night_filled[inside_mask]))
lst_night_max = float(np.max(lst_night_filled[inside_mask]))


# 5. Ward-level stats
def borough_stats(values, borough_ids, borough_id):
    mask = (borough_ids == borough_id)
    pix_vals = values[mask]
    pix_vals = pix_vals[np.isfinite(pix_vals)]

    if pix_vals.size == 0:
        return {
            "pixel_count": 0,
            "min": None,
            "q1": None,
            "median": None,
            "q3": None,
            "max": None,
            "mean": None,
            "std": None,
        }

    q1, med, q3 = np.percentile(pix_vals, [25, 50, 75])
    return {
        "pixel_count": int(pix_vals.size),
        "min": float(np.min(pix_vals)),
        "q1": float(q1),
        "median": float(med),
        "q3": float(q3),
        "max": float(np.max(pix_vals)),
        "mean": float(np.mean(pix_vals)),
        "std": float(np.std(pix_vals)),
    }


boroughs_output = []
unique_boroughs = sorted(int(i) for i in np.unique(borough_ids) if i > 0)

for wid in unique_boroughs:
    name = borough_names.get(wid, f"Borough {wid}")
    code = borough_codes.get(wid, name)

    mask = (borough_ids == wid)
    rows, cols = np.where(mask)

    def rc_to_lonlat(r, c):
        lon = MIN_LON + (c + 0.5) * (MAX_LON - MIN_LON) / W
        lat = MIN_LAT + (r + 0.5) * (MAX_LAT - MIN_LAT) / H
        return lon, lat

    min_r, max_r = rows.min(), rows.max()
    min_c, max_c = cols.min(), cols.max()

    lon_min, lat_min = rc_to_lonlat(max_r, min_c)  # bottom-left
    lon_max, lat_max = rc_to_lonlat(min_r, max_c)  # top-right
    lon_cent, lat_cent = rc_to_lonlat(rows.mean(), cols.mean())

    ndvi_stats = borough_stats(ndvi_filled, borough_ids, wid)
    day_stats = borough_stats(lst_day_filled, borough_ids, wid)
    night_stats = borough_stats(lst_night_filled, borough_ids, wid)

    boroughs_output.append({
        "id": wid,
        "name": name,
        "code": code,
        "centroid": {"lon": lon_cent, "lat": lat_cent},
        "bbox": [lon_min, lat_min, lon_max, lat_max],

        "pixel_count": ndvi_stats["pixel_count"],

        "ndvi_min": ndvi_stats["min"],
        "ndvi_q1": ndvi_stats["q1"],
        "ndvi_median": ndvi_stats["median"],
        "ndvi_q3": ndvi_stats["q3"],
        "ndvi_max": ndvi_stats["max"],
        "ndvi_mean": ndvi_stats["mean"],
        "ndvi_std": ndvi_stats["std"],

        "lst_day_min": day_stats["min"],
        "lst_day_q1": day_stats["q1"],
        "lst_day_median": day_stats["median"],
        "lst_day_q3": day_stats["q3"],
        "lst_day_max": day_stats["max"],
        "lst_day_mean": day_stats["mean"],
        "lst_day_std": day_stats["std"],

        "lst_night_min": night_stats["min"],
        "lst_night_q1": night_stats["q1"],
        "lst_night_median": night_stats["median"],
        "lst_night_q3": night_stats["q3"],
        "lst_night_max": night_stats["max"],
        "lst_night_mean": night_stats["mean"],
        "lst_night_std": night_stats["std"],
    })


grid_out = {
    "city": "San Diego",
    "crs": "EPSG:4326",
    "width": int(W),
    "height": int(H),
    "bbox": [MIN_LON, MIN_LAT, MAX_LON, MAX_LAT],

    "ward_ids": borough_ids.reshape(-1).astype(int).tolist(),
    "ndvi": ndvi_grid.reshape(-1).astype(float).tolist(),
    "lst_day_C": lst_day_grid.reshape(-1).astype(float).tolist(),
    "lst_night_C": lst_night_grid.reshape(-1).astype(float).tolist(),

    "ndvi_min": ndvi_min,
    "ndvi_max": ndvi_max,
    "lst_day_min": lst_day_min,
    "lst_day_max": lst_day_max,
    "lst_night_min": lst_night_min,
    "lst_night_max": lst_night_max,
}

with open(GRID_OUT, "w", encoding="utf-8") as f:
    json.dump(grid_out, f)
print("Wrote", GRID_OUT)

boroughs_out = {
    "city": "New York City",
    "crs": "EPSG:4326",
    "num_wards": len(boroughs_output),
    "wards": boroughs_output,
}

with open(BOROUGHS_OUT, "w", encoding="utf-8") as f:
    json.dump(boroughs_out, f)
print("Wrote", BOROUGHS_OUT)