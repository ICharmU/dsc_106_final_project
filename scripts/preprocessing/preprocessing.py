import json
import os
import glob
import numpy as np
import tifffile
import shapely
from shapely.geometry import shape, Point

def preprocess(city, NDVI_TIF, LST_TIF, LC_TIF, mult_json, BOUND_PATH, GRID_OUT, WARDS_OUT, LAT_LONG):
    """
    Generic preprocessing script
    Parameters:
        city - Name of the city
        NDVI_TIF - Path to the NDVI file
        LST_TIF - Path to the LST file
        LC_TIF - Path to the LC file
        mult_json - Boolean, True if using multiple geojson files for boundaries,
                    False if using single geojson file for boundaries
        BOUND_PATH - Path to folder for geojson boundary files if mult_json is True,
                     path to geojson boundary file if mult_json is False
        GRID_OUT - Output file path for grid file
        WARDS_OUT - Output file path for ward level stats file
        LAT_LONG - List in format of [Minimum longitude, minimum latitude, maximum longitude,
                    maximum latitude] for the city
    """
    
    MIN_LON, MIN_LAT, MAX_LON, MAX_LAT = LAT_LONG;

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
    
    def common_lc(arr):
        comm_lc = {};
        for elem in arr:
            if elem in comm_lc:
                comm_lc[elem] += 1;
            else:
                comm_lc[elem] = 0;
        return max(comm_lc, key=comm_lc.get)

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

    # 1. Load LC (single-band)
    lc_raw = tifffile.imread(LC_TIF)  # (H,W) or (1,H,W)
    if lc_raw.ndim == 3:
        lc_raw = lc_raw[0]
    lc_map = {
        0: 'No Data',
        1: 'Evergreen Needleleaf Forests',
        2: 'Evergreen Broadleaf Forests',
        3: 'Deciduous Needleleaf Forests', 
        4: 'Deciduous Broadleaf Forests',
        5: 'Mixed Forests',
        6: 'Closed Shrublands',
        7: 'Open Shrublands',
        8: 'Woody Savannas',
        9: 'Savannas',
        10: 'Grasslands',
        11: 'Permanent Wetlands',
        12: 'Croplands',
        13: 'Urban and Built-up Lands',
        14: 'Cropland/Natural Vegetation Mosaics',
        15: 'Permanent Snow and Ice',
        16: 'Barren',
        17: 'Water Bodies'
    };
    vectorized_func = np.vectorize(lambda x: lc_map[x]);
    lc = vectorized_func(lc_raw);

    geoms = [];
    ward_ids = np.zeros((H, W), dtype="int32")
    ward_names = {}

    if mult_json:
        pattern = os.path.join(BOUND_PATH, "*.geo.json")
        ward_index = 1
        for path in sorted(glob.glob(pattern)):
            base = os.path.basename(path)
            # skip obvious temp files if present
            if base.startswith("temp_"):
                continue

            with open(path, "r", encoding="utf-8") as f:
                gj = json.load(f)

            # Handle either FeatureCollection or single Feature
            if gj.get("type") == "FeatureCollection":
                feats = gj.get("features", [])
            elif gj.get("type") == "Feature":
                feats = [gj]
            else:
                continue

            for feat in feats:
                geom = shape(feat["geometry"])
                props = feat.get("properties", {}) or {}

                # Try a few common property names, fall back to filename
                raw_name = (
                    props.get("name")
                    or props.get("NAME")
                    or props.get("ward")
                    or props.get("WardName")
                    or props.get("NAMELATIN")
                    or os.path.splitext(base)[0].replace(".geo", "")
                )

                # Clean up filename-based names: "adachi-ku" -> "Adachi-Ku"
                name = raw_name.replace("_", " ").replace("-", " ").title()

                geoms.append(geom)
                ward_names[ward_index] = name
                ward_index += 1
    else:
        with open(BOUND_PATH, "r", encoding="utf-8") as f:
            gj = json.load(f)
            features = gj["features"]
            geoms = [shapely.make_valid(shape(feat["geometry"])) for feat in features]
            for idx, feat in enumerate(features, start=1):
                props = feat.get("properties", {})
                name = (
                    props.get("name")
                    or props.get("ward")
                    or props.get("NAME")
                    or props.get("WardName")
                    or props.get("BoroName")
                    or props.get("JUR_NAME")
                    or f"Ward {idx}"
                )
                name = name.replace("_", " ").replace("-", " ").title();
                ward_names[idx] = name

    # assign each pixel to a ward by its centre point
    for r in range(H):
        lat = MIN_LAT + (r + 0.5) * (MAX_LAT - MIN_LAT) / H
        for c in range(W):
            lon = MIN_LON + (c + 0.5) * (MAX_LON - MIN_LON) / W
            pt = Point(lon, lat)
            for i, geom in enumerate(geoms, start=1):
                if geom.contains(pt):
                    ward_ids[r, c] = i
                    break

    inside_mask = ward_ids > 0


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
    lc_max = common_lc(lc[inside_mask]);


    # 5. Ward-level stats
    def ward_stats(values, ward_ids, ward_id):
        mask = (ward_ids == ward_id)
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


    wards_output = []
    unique_wards = sorted(int(i) for i in np.unique(ward_ids) if i > 0)

    for wid in unique_wards:
        name = ward_names.get(wid, f"Ward {wid}")

        mask = (ward_ids == wid)
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

        ndvi_stats = ward_stats(ndvi_filled, ward_ids, wid)
        day_stats = ward_stats(lst_day_filled, ward_ids, wid)
        night_stats = ward_stats(lst_night_filled, ward_ids, wid)

        lc_mask = (ward_ids == wid)
        lc_pix_vals = lc[lc_mask]
        ward_lc = "No data";
        if lc_pix_vals.size != 0:
            ward_lc = common_lc(lc_pix_vals);

        wards_output.append({
            "id": wid,
            "name": name,
            "centroid": {"lon": lon_cent, "lat": lat_cent},
            "bbox": [lon_min, lat_min, lon_max, lat_max],

            "pixel_count": ndvi_stats["pixel_count"],

            "lc_mode": ward_lc,

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
        "city": city,
        "crs": "EPSG:102400",
        "width": int(W),
        "height": int(H),
        "bbox": [MIN_LON, MIN_LAT, MAX_LON, MAX_LAT],

        "ward_ids": ward_ids.reshape(-1).astype(int).tolist(),
        "ndvi": ndvi_grid.reshape(-1).astype(float).tolist(),
        "lst_day_C": lst_day_grid.reshape(-1).astype(float).tolist(),
        "lst_night_C": lst_night_grid.reshape(-1).astype(float).tolist(),
        "lc": lc.reshape(-1).tolist(),

        "ndvi_min": ndvi_min,
        "ndvi_max": ndvi_max,
        "lst_day_min": lst_day_min,
        "lst_day_max": lst_day_max,
        "lst_night_min": lst_night_min,
        "lst_night_max": lst_night_max,
        "lc_max": lc_max
    }

    with open(GRID_OUT, "w", encoding="utf-8") as f:
        json.dump(grid_out, f)
    print("Wrote", GRID_OUT)

    wards_out = {
        "city": city,
        "crs": "EPSG:102400",
        "num_wards": len(wards_output),
        "wards": wards_output,
    }

    with open(WARDS_OUT, "w", encoding="utf-8") as f:
        json.dump(wards_out, f)
    print("Wrote", WARDS_OUT)

#TOKYO_NDVI = "data/tokyo/tokyo_NDVI.tif"
#TOKYO_LST  = "data/tokyo/tokyo_LST.tif"
#TOKYO_LC = "data/tokyo/tokyo_LC.tif"
#TOKYO_WARDS_DIR = "data/tokyo_wards"
#TOKYO_GRID_OUT = "data/tokyo/tokyo_grid.json"
#TOKYO_WARDS_OUT = "data/tokyo/tokyo_wards.json"
#TOKYO_LAT_LONG = [139.3, 35.4, 140.2, 36.2];
#preprocess("Tokyo", TOKYO_NDVI, TOKYO_LST, TOKYO_LC, True, TOKYO_WARDS_DIR, TOKYO_GRID_OUT, TOKYO_WARDS_OUT, TOKYO_LAT_LONG);

#LONDON_NDVI = "data/london/london_NDVI_2020_summer.tif"
#LONDON_LST  = "data/london/london_LST_2020_summer.tif"
#LONDON_LC = "data/london/london_LC_2020.tif"
#LONDON_WARDS_DIR = "data/london/boundaries/london32.json"
#LONDON_GRID_OUT = "data/london/london_grid.json"
#LONDON_WARDS_OUT = "data/london/london_boroughs.json"
#LONDON_LAT_LONG = [-0.5, 51.3, 0.3, 51.7];
#preprocess("London", LONDON_NDVI, LONDON_LST, LONDON_LC, False, LONDON_WARDS_DIR, LONDON_GRID_OUT, LONDON_WARDS_OUT, LONDON_LAT_LONG);

#NYC_NDVI = "data/nyc/nyc_NDVI.tif"
#NYC_LST  = "data/nyc/nyc_LST.tif"
#NYC_LC = "data/nyc/nyc_LC.tif"
#NYC_WARDS_DIR = "data/nyc/boundaries/nyc.json"
#NYC_GRID_OUT = "data/nyc/nyc_grid.json"
#NYC_WARDS_OUT = "data/nyc/nyc_boroughs.json"
#NYC_LAT_LONG = [-74.27, 40.49, -73.68, 40.92];
#preprocess("New York City", NYC_NDVI, NYC_LST, NYC_LC, False, NYC_WARDS_DIR, NYC_GRID_OUT, NYC_WARDS_OUT, NYC_LAT_LONG);

#SD_NDVI = "data/san-diego/sandiego_NDVI.tif"
#SD_LST  = "data/san-diego/sandiego_LST.tif"
#SD_LC = "data/san-diego/sandiego_LC.tif"
#SD_WARDS_DIR = "data/san-diego/boundaries/Council_Districts.geojson"
#SD_GRID_OUT = "data/san-diego/sandiego_grid.json"
#SD_WARDS_OUT = "data/san-diego/sandiego_boroughs.json"
#SD_LAT_LONG = [-117.6, 32.53, -116.08, 33.49];
#preprocess("San Diego", SD_NDVI, SD_LST, SD_LC, False, SD_WARDS_DIR, SD_GRID_OUT, SD_WARDS_OUT, SD_LAT_LONG);