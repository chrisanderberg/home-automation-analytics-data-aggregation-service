declare module "suncalc" {
  export function getTimes(
    date: Date,
    lat: number,
    lng: number,
    height?: number
  ): {
    solarNoon: Date;
    nadir: Date;
    sunrise: Date;
    sunset: Date;
    [key: string]: Date;
  };
  export function getPosition(
    date: Date,
    lat: number,
    lng: number
  ): { azimuth: number; altitude: number };
}
