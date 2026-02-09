# TV Show Chart
Compare the scores of TV series against each other using IMDb data

## Development
- Install dependencies: `npm install && uv sync`
- Download IMDb data: `uv run imdb-sqlite --only "episodes,ratings,titles"`
- Generate episodes database: `uv run python generate_data.py`
- Build site: `npm run build` (outputs to `public-build/`)

## Deployment
This project uses GitHub Actions to automatically build and deploy the site on every push to `main`. The built site (with generated data) is published to the `public` branch, which can be used with GitHub Pages.

To enable GitHub Pages:
1. Go to repository Settings → Pages
2. Set the Source to "Deploy from a branch"
3. Select the `public` branch as the source

## License
Data is provided by IMDb and not covered under the license on this repo.
