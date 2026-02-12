# **App Name**: Neetarded

## Core Features:

- User Authentication: Implement secure email/password authentication using Firebase Auth.
- Unique User ID Generation: Generate a unique 6-character alphanumeric ID upon user signup.
- User Data Storage: Store user data (Name, Email, Unique ID) in Firestore's 'users' collection.
- Protected Dashboard Route: Implement route protection to ensure only authenticated users can access the dashboard.
- Dashboard Display: Display user's name and unique ID on the dashboard.
- Quiz Analysis and Customization Suggestions: Suggest adjustments or areas to improve based on historical quizzes, using the gemini-2.5-flash-lite AI model tool.
- Mobile-First Responsive Layout: Design a fully responsive layout with bottom navigation on mobile and a sidebar on desktop.

## Style Guidelines:

- Primary color: Deep violet (#6750A4) for a premium and serious feel.
- Background color: Light slate gray (#F2F4F7) for a clean, minimalist aesthetic.
- Accent color: Electric blue (#7DF9FF) to highlight key elements and calls to action.
- Font: 'Inter' (sans-serif) for a clean and readable interface. Note: currently only Google Fonts are supported.
- Use 'Lucide-React' icons for a consistent and minimalist visual language.
- Mobile-first design with large touch targets for buttons and smooth focus states for inputs.
- Subtle transitions and animations to improve user experience without being flashy.