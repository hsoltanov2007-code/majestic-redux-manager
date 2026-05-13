export type Redux = {
  id: string;
  name: string;
  version: string;
  description: string;
  size: string;
  downloadUrl: string;
  installed: boolean;
  installedVersion?: string;
};

export const REDUXES: Redux[] = [
  {
    id: "test-redux",
    name: "Test Redux",
    version: "1.0.0",
    description: "Тестовый redux",
    size: "500 MB",
    downloadUrl: "https://github.com/YOUR_NAME/YOUR_REPO/releases/download/v1/redux.zip",
    installed: false,
  },
];
