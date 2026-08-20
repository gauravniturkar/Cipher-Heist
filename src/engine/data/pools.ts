/**
 * Content templates for the case generator.
 *
 * These are deliberately *structured*, not free text: each archetype carries
 * its own vocabulary so a generated case never mixes a museum vault with a
 * locomotive's guard van. The generator picks within one archetype and fills
 * slots, which is what keeps randomised cases internally consistent.
 */

export interface Archetype {
  id: string;
  /** e.g. "the Harwick Museum of Natural History". */
  places: string[];
  cities: string[];
  /** The thing that goes missing. */
  objects: string[];
  incidents: string[];
  /** Named areas. The first is always where the incident happens. */
  locations: string[];
  /** Roles are drawn without replacement, so no two suspects share one. */
  roles: string[];
  /** Ambient details used in story beats. */
  atmosphere: string[];
  /** How the case file titles itself. */
  titleForms: string[];
}

export const ARCHETYPES: readonly Archetype[] = [
  {
    id: 'museum',
    places: [
      'the Harwick Museum of Natural History',
      'the Verrall Institute of Antiquities',
      'the Ondrey Mineral Gallery',
      'the Sable Court Museum',
    ],
    cities: ['Bengaluru', 'Edinburgh', 'Lisbon', 'Montreal', 'Kyoto'],
    objects: [
      'the Meridian Diamond',
      'the Ashcombe Astrolabe',
      'the Vermilion Reliquary',
      'the Ptolemy Fragment',
    ],
    incidents: [
      'lifted from its pedestal during the winter gala',
      'swapped for a resin replica between two guard rounds',
      'removed from the vault without a single alarm firing',
    ],
    locations: ['Vault Room', 'Glass Atrium', 'Paper Archive', 'Roof Terrace', 'Service Corridor', 'Loading Dock'],
    roles: [
      'staff gemologist', 'senior curator', 'head of security', 'visiting art dealer',
      'insurance investigator', 'night porter', 'conservation technician', 'gala caterer',
    ],
    atmosphere: [
      'Rain hammers the skylight above the atrium.',
      'The gala string quartet is still packing up in the west wing.',
      'Every clock in the building runs ninety seconds fast.',
      'The humidity alarms have been muted since October.',
    ],
    titleForms: ['The {object} Affair', 'The Vanishing at {place}', 'A Theft in {city}'],
  },
  {
    id: 'station',
    places: [
      'Halvard Station, an Arctic research post',
      'the Kestrel Deep-Sea Platform',
      'the Ridgeline Seismic Outpost',
      'Camp Tessaly, a glacier survey base',
    ],
    cities: ['Svalbard', 'the Ross Sea', 'the Faroe Shelf', 'Baffin Bay'],
    objects: [
      'the Halvard ice core',
      'the prototype sensor array',
      'six months of unpublished survey data',
      'the sealed sample cabinet key',
    ],
    incidents: [
      'taken from cold storage during the generator outage',
      'wiped from the archive between two backups',
      'removed from the lab while the storm siren ran',
    ],
    locations: ['Cold Store', 'Lab Two', 'Radio Room', 'Generator Bay', 'Greenhouse Dome', 'Supply Tunnel'],
    roles: [
      'station glaciologist', 'communications officer', 'field engineer', 'visiting postdoc',
      'supply pilot', 'station physician', 'data archivist', 'maintenance lead',
    ],
    atmosphere: [
      'The storm has kept everyone indoors for eleven days.',
      'Outside it is dark until March.',
      'The backup generator coughs every few minutes.',
      'Nobody can leave until the weather window opens.',
    ],
    titleForms: ['The {object} Incident', 'Dark Season at {place}', 'Cold Storage'],
  },
  {
    id: 'train',
    places: [
      'the Ashgrove Express',
      'the overnight Coromandel Mail',
      'the Caledonian Sleeper, service 214',
      'the Trans-Ligurian night train',
    ],
    cities: ['a stretch of track outside Nagpur', 'the Highlands', 'the Apennine tunnels', 'the Danube line'],
    objects: [
      'the Ashgrove ledger',
      'a courier case of bearer bonds',
      'the Marchetti violin',
      'a sealed diplomatic pouch',
    ],
    incidents: [
      'taken from a locked compartment between two stations',
      'switched during the twenty-minute crew change',
      'lifted while the train sat dark in a tunnel',
    ],
    locations: ['Compartment 4B', 'Dining Car', 'Guard Van', 'Observation Deck', 'Engine Cab', 'Luggage Hold'],
    roles: [
      'sleeping-car attendant', 'train guard', 'dining steward', 'private courier',
      'railway inspector', 'travelling antiquarian', 'signal engineer', 'night conductor',
    ],
    atmosphere: [
      'The train has not stopped since the incident.',
      'Rain streaks sideways across every window.',
      'The corridor lights flicker at each set of points.',
      'Nobody has left the carriage since midnight.',
    ],
    titleForms: ['The {object} Run', 'Night Train to {city}', 'The Sleeper Car Problem'],
  },
  {
    id: 'observatory',
    places: [
      'the Perseid Ridge Observatory',
      'the Cavallo Radio Array',
      'the Nilgiri Optical Station',
      'the Brack Hill Solar Telescope',
    ],
    cities: ['the Atacama', 'the Nilgiris', 'La Palma', 'the Karoo'],
    objects: [
      'the Perseid plate archive',
      'the calibration mirror',
      'four nights of unpublished spectra',
      'the array timing key',
    ],
    incidents: [
      'removed from the plate vault during the maintenance window',
      'deleted from the array between two observing runs',
      'taken while the dome was open for the transit',
    ],
    locations: ['Plate Vault', 'Control Room', 'Dome Floor', 'Timing Hut', 'Machine Shop', 'Dormitory Wing'],
    roles: [
      'night assistant', 'instrument engineer', 'visiting astronomer', 'array technician',
      'science archivist', 'facility manager', 'graduate observer', 'calibration specialist',
    ],
    atmosphere: [
      'The dome is still open and the air is bitter.',
      'The transit will not repeat for another eleven years.',
      'Every log in the building is timestamped in UTC.',
      'Cloud rolled in an hour after the incident.',
    ],
    titleForms: ['The {object} Problem', 'Dark Time at {place}', 'Transit Night'],
  },
];

/** Given and family names are drawn from separate pools, then paired. */
export const GIVEN_NAMES = [
  'Anika', 'Bram', 'Camille', 'Dev', 'Eleni', 'Farid', 'Greta', 'Hana', 'Idris', 'Juno',
  'Kiran', 'Lena', 'Mateo', 'Nadia', 'Omar', 'Priya', 'Quinn', 'Rosa', 'Sunil', 'Tova',
  'Ulrich', 'Vera', 'Wren', 'Xiulan', 'Yusuf', 'Zara', 'Martin', 'Clara', 'Ines', 'Nikhil',
];

export const FAMILY_NAMES = [
  'Voss', 'Mesh', 'Roshan', 'Halloran', 'Okoye', 'Bellamy', 'Ferreira', 'Nakamura', 'Duarte',
  'Kaur', 'Lindqvist', 'Marchetti', 'Osei', 'Petrov', 'Quintero', 'Rasmussen', 'Sinclair',
  'Tremont', 'Ueda', 'Varga', 'Whitlock', 'Yarrow', 'Zhao', 'Ashcombe', 'Bhatt',
];

export const MOTIVES = [
  'is buried in gambling debt and three months behind on it',
  'was passed over for a promotion they had been promised in writing',
  'is being quietly blackmailed over an old forgery',
  'has a buyer waiting who asked no questions',
  'was about to be exposed for falsifying records',
  'believes the piece was taken from their family two generations ago',
  'needs the insurance payout to keep a failing business alive',
  'was told their contract ends at the close of the season',
];

export const RELATION_TEMPLATES: { kind: import('../../types.js').RelationKind; note: string }[] = [
  { kind: 'rivals', note: '{a} and {b} have competed for the same position for two years.' },
  { kind: 'owes-money', note: '{a} owes {b} a sum neither will name out loud.' },
  { kind: 'former-partners', note: '{a} and {b} ran a business together until it collapsed.' },
  { kind: 'siblings', note: '{a} and {b} are half-siblings; almost nobody here knows.' },
  { kind: 'mentor', note: '{b} trained {a}, and still signs off on their work.' },
  { kind: 'protecting', note: '{a} has covered for {b} once before, on record.' },
];

export const RED_HERRING_REASONS = [
  'was seen carrying an unmarked case away from the scene',
  'gave two different accounts of the same ten minutes',
  'had searched for the value of the item that same week',
  'was found with a key that should have been handed in',
];

export const EXONERATION_TEMPLATES = [
  '{name} was on a recorded call for the whole window - the log is timestamped and independent.',
  'Two witnesses put {name} in {place} for the entire window, and the door badge agrees.',
  'A camera nobody had checked shows {name} in {place} from start to finish.',
  '{name}’s medical appointment ran long; the clinic confirms the time in writing.',
];

export const METHODS = [
  'used a duplicated badge to walk in through a door that logs nothing',
  'cut the alarm loop for four minutes and put it back exactly as it was',
  'swapped the item during the handover, when two logs disagree by design',
  'hid the item in equipment that was scheduled to leave the building anyway',
];
