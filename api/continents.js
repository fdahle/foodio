const GROUPS = {
  'Europe': 'AL AD AT BY BE BA BG HR CY CZ DK EE FI FR DE GR HU IS IE IT XK LV LI LT LU MT MD ME NL MK NO PL PT RO RU RS SK SI ES SE CH UA GB',
  'Middle East': 'TR LB SY JO PS IL IR IQ SA AE QA KW BH OM YE GE AM AZ',
  'Africa': 'EG MA DZ TN LY ET ER DJ KE TZ UG RW BI SO NG GH TG BJ SN GM ML GN CI CM CD CG GA ZA NA BW LS SZ ZW MZ ZM MW AO SD MG CV MU RE SC KM BF NE TD SL LR CF MR',
  'Asia': 'IN PK BD LK NP BT MV AF CN TW HK MO JP KR KP TH VN ID MY SG PH KH LA MM BN TL UZ KZ KG TJ TM MN',
  'North America': 'US CA',
  'Latin America & Caribbean': 'MX GT SV HN NI CR PA BZ CU JM DO HT TT BB BS PR GY SR CO VE EC BO PE BR AR UY PY CL GP MQ CW AW BQ',
  'Oceania': 'AU NZ FJ WS TO PG VU CK PF NC',
}

export const CONTINENTS = [...Object.keys(GROUPS), 'Other']

const BY_CODE = {}
for (const [name, codes] of Object.entries(GROUPS)) for (const c of codes.split(' ')) BY_CODE[c] = name

export const continentOf = countries => BY_CODE[countries?.[0]] || 'Other'
