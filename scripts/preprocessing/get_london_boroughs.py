import requests
import json

def fetch_london_boroughs():
    """
    Fetches London borough GeoJSON data from a reliable source,
    filters for London boroughs, normalizes properties, and saves it.
    """
    sources = [
        'https://raw.githubusercontent.com/radoi90/london-boroughs-geojson/master/london_boroughs.geojson',
        'https://opendata.arcgis.com/datasets/8edafbe3276d4b56aec60991cbddda50_4.geojson',
        'https://raw.githubusercontent.com/martinjc/UK-GeoJSON/master/json/administrative/eng/lad.json'
    ]

    for source in sources:
        try:
            print(f"Attempting to download from: {source}")
            response = requests.get(source)
            response.raise_for_status()  # Raise an exception for bad status codes
            data = response.json()
            print("Successfully downloaded data.")

            # Filter and normalize data
            if 'lad.json' in source:
                print("Filtering for London boroughs...")
                data['features'] = [
                    f for f in data['features']
                    if f.get('properties', {}).get('LAD13NM') and
                    (
                        'London' in f['properties']['LAD13NM'] or
                        f['properties']['LAD13NM'] in [
                            'Westminster', 'Camden', 'Islington', 'Hackney', 'Tower Hamlets',
                            'Greenwich', 'Lewisham', 'Southwark', 'Lambeth', 'Wandsworth',
                            'Hammersmith and Fulham', 'Kensington and Chelsea', 'Brent',
                            'Ealing', 'Hounslow', 'Richmond upon Thames', 'Kingston upon Thames',
                            'Merton', 'Sutton', 'Croydon', 'Bromley', 'Bexley', 'Havering',
                            'Barking and Dagenham', 'Redbridge', 'Newham', 'Waltham Forest',
                            'Haringey', 'Enfield', 'Barnet', 'Harrow', 'Hillingdon', 'City of London'
                        ]
                    )
                ]
                print(f"Found {len(data['features'])} London boroughs.")

            # Normalize properties to match the 'tokyo23.json' format if possible
            # Based on boroughs.js, we just need a 'name' property.
            for feature in data['features']:
                props = feature.get('properties', {})
                name = props.get('name') or props.get('NAME') or props.get('LAD13NM') or 'Unknown'
                feature['properties'] = {'name': name}

            # Save the data
            output_path = 'data/london/boundaries/london_boroughs.json'
            with open(output_path, 'w', encoding='utf-8') as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
            
            print(f"Successfully saved London boroughs GeoJSON to {output_path}")
            return

        except requests.exceptions.RequestException as e:
            print(f"Failed to download from {source}: {e}")
        except Exception as e:
            print(f"An error occurred: {e}")

    print("All sources failed. Could not retrieve London boroughs data.")

if __name__ == '__main__':
    fetch_london_boroughs()
