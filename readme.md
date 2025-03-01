<!-- @format -->

# Baton SQL Extension

The Baton SQL Extension is a Visual Studio Code extension that allows you to manually apply a JSON schema to YAML files with names matching the pattern `baton-sql-*`. This extension is particularly useful for validating Baton SQL configuration files and ensuring that the schema rules are enforced consistently.

## Features

- Manually apply the Baton SQL schema to the current YAML file
- Validate YAML structure against the schema
- Provide feedback on schema validation errors

## Installation

1. Clone the repository:

```bash
git clone https://github.com/yourusername/baton-sql-extension.git
cd baton-sql-extension
```

1. Install dependencies and build the extension:

```bash
npm install
npm run build
```

1. Package the extension:

```bash
vsce package
```

1. Install the `.vsix` file in Visual Studio Code:

- Open VS Code
- Go to Extensions panel
- Click the "..." menu and select "Install from VSIX..."
- Select the generated `.vsix` file

## Usage

1. Open a YAML file with a name matching `baton-sql-*`
2. Open the Command Palette (`Cmd + Shift + P` or `Ctrl + Shift + P`)
3. Run the command: `Apply Baton SQL Schema to Current File`
4. The schema will be applied, and any validation errors will be displayed

## Development

To run the extension in development mode:

```bash
npm run build
code .
```

Then press `F5` to open a new Extension Development Host window.

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/YourFeature`)
3. Commit your changes (`git commit -m 'Add YourFeature'`)
4. Push to the branch (`git push origin feature/YourFeature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the LICENSE file for details.
