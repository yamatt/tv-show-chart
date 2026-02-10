const path = require('path');
const CopyPlugin = require('copy-webpack-plugin');

module.exports = {
  entry: './src/display.js',
  output: {
    path: path.resolve(__dirname, 'public-build'),
    filename: 'bundle.js'
  },
  plugins: [
    new CopyPlugin({
      patterns: [
        { from: 'src/index.html', to: 'index.html' },
      ],
    }),
  ],
};
