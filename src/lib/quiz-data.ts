
export interface ChapterData {
  binaryCode: string;
  name: string;
}

export interface SubjectData {
  id: '1B0' | '2P0' | '3C0';
  name: 'Biology' | 'Physics' | 'Chemistry';
  chapters: ChapterData[];
}

export const QUIZ_SUBJECTS: SubjectData[] = [
  {
    id: '1B0',
    name: 'Biology',
    chapters: [
      { binaryCode: '1B0-001', name: 'The Living World' },
      { binaryCode: '1B0-002', name: 'Biological Classification' },
      { binaryCode: '1B0-003', name: 'Plant Kingdom' },
      { binaryCode: '1B0-004', name: 'Animal Kingdom' },
    ],
  },
  {
    id: '2P0',
    name: 'Physics',
    chapters: [
      { binaryCode: '2P0-001', name: 'Units and Measurements' },
      { binaryCode: '2P0-002', name: 'Motion in a Straight Line' },
      { binaryCode: '2P0-003', name: 'Motion in a Plane' },
      { binaryCode: '2P0-004', name: 'Laws of Motion' },
    ],
  },
  {
    id: '3C0',
    name: 'Chemistry',
    chapters: [
      { binaryCode: '3C0-001', name: 'Some Basic Concepts of Chemistry' },
      { binaryCode: '3C0-002', name: 'Structure of Atom' },
      { binaryCode: '3C0-003', name: 'Classification of Elements and Periodicity' },
      { binaryCode: '3C0-004', name: 'Chemical Bonding and Molecular Structure' },
    ],
  },
];

export const getSubjectById = (id: string) => QUIZ_SUBJECTS.find(s => s.id === id);
    