module.exports = {
  preset: 'react-native',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  testMatch: ['**/__tests__/**/*.test.ts', '**/__tests__/**/*.test.tsx'],
  testPathIgnorePatterns: ['/node_modules/', '/android/', '/ios/', '/e2e/', 'App.test.tsx'],
  moduleNameMapper: { '^@/(.*)$': '<rootDir>/src/$1' },
  transformIgnorePatterns: ['node_modules/(?!(react-native|@react-native|@react-navigation|react-native-.*|@react-native-.*|moti|@motify|@gorhom|@shopify)/)',],
  testEnvironment: 'node',
  clearMocks: true,
  verbose: true,
  testTimeout: 10000,
};
