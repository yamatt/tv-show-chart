var show_chart = null;
var db = null;
var last_search_term = null;
var search_timer = null;

function initDatabase() {
    return Promise.resolve().then(function() {
        function loadDatabase(sqlInstance) {
            console.log('Fetching episodes.db...');
            return fetch('episodes.db')
                .then(response => {
                    console.log('Fetch response status:', response.status);
                    if (!response.ok) {
                        throw new Error('Failed to fetch database: ' + response.status + ' ' + response.statusText);
                    }
                    return response.arrayBuffer();
                })
                .then(buffer => {
                    console.log('Database buffer size:', buffer.byteLength);
                    if (buffer.byteLength === 0) {
                        throw new Error('Database file is empty');
                    }
                    db = new sqlInstance.Database(new Uint8Array(buffer));
                    console.log('Database loaded successfully');
                });
        }

        if (typeof SQL !== 'undefined') {
            console.log('Using pre-loaded SQL.js');
            return loadDatabase(SQL);
        }

        if (typeof initSqlJs !== 'function') {
            throw new Error('sql.js not loaded');
        }

        console.log('Loading SQL.js...');
        return initSqlJs({
            locateFile: function(file) {
                return "https://sql.js.org/dist/" + file;
            }
        }).then(function(SQL_INSTANCE) {
            console.log('SQL.js loaded successfully');
            window.SQL = SQL_INSTANCE;
            return loadDatabase(SQL_INSTANCE);
        });
    }).catch(function(error) {
        console.error('Failed to load database:', error);
        var title = document.querySelector('h1');
        if (title) {
            title.textContent = 'Error: ' + error.message;
        }
        throw error;
    });
}

function get_show_id() {
    var hash = window.location.hash;
    if (hash && hash.length > 1) {
        return hash.substring(1);
    }
    return null;
}

function normalize_text(value) {
    return (value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function score_match(name, query) {
    if (!name || !query) {
        return 0;
    }
    var name_norm = normalize_text(name);
    var query_norm = normalize_text(query);
    if (!query_norm) {
        return 0;
    }
    if (name_norm === query_norm) {
        return 1000;
    }
    if (name_norm.startsWith(query_norm)) {
        return 800;
    }
    if (name_norm.indexOf(query_norm) !== -1) {
        return 600;
    }
    var tokens = query_norm.split(' ');
    var score = 0;
    tokens.forEach(function(token) {
        if (token && name_norm.indexOf(token) !== -1) {
            score += 100;
        }
    });
    return score;
}

function render_show_results(results, query) {
    var container = document.getElementById('show_results');
    if (!container) {
        return;
    }
    if (!results.length) {
        container.style.display = 'none';
        container.innerHTML = '';
        return;
    }

    var items = results.map(function(row) {
        var label = row.name;
        if (row.year) {
            label += ' (' + row.year + ')';
        }
        return '<li class="pure-menu-item"><a href="#" class="pure-menu-link" data-show-id="' + row.id + '">' + label + '</a></li>';
    });

    container.innerHTML = '<ul class="pure-menu-list">' + items.join('') + '</ul>';
    container.style.display = 'block';

    container.querySelectorAll('a[data-show-id]').forEach(function(link) {
        link.addEventListener('click', function(event) {
            event.preventDefault();
            var show_id = event.currentTarget.getAttribute('data-show-id');
            update_chart(show_id);
            container.style.display = 'none';
        });
    });
}

function search_shows_by_name(query) {
    if (!db) {
        return [];
    }
    var normalized = normalize_text(query);
    if (!normalized) {
        return [];
    }
    var tokens = normalized.split(' ').filter(function(token) {
        return token.length > 0;
    });
    var where_clause = tokens.map(function() {
        return 'lower(name) LIKE ?';
    }).join(' AND ');
    if (!where_clause) {
        return [];
    }
    var params = tokens.map(function(token) {
        return '%' + token + '%';
    });
    var results = db.exec(
        'SELECT name, id, year FROM shows WHERE ' + where_clause + ' LIMIT 100',
        params
    );
    if (!results.length) {
        return [];
    }
    var rows = results[0].values.map(function(row) {
        return { name: row[0], id: row[1], year: row[2] };
    });
    rows.forEach(function(row) {
        row._score = score_match(row.name, query);
    });
    rows.sort(function(a, b) {
        return b._score - a._score;
    });
    return rows.slice(0, 15);
}

function update_show_title(show_id) {
    if (!db) {
        return;
    }
    var results = db.exec(
        'SELECT name, year FROM shows WHERE id = ? LIMIT 1',
        [show_id]
    );
    var title_el = document.querySelector('h1');
    if (!title_el) {
        return;
    }
    if (!results.length || !results[0].values.length) {
        title_el.textContent = show_id;
        return;
    }
    var row = results[0].values[0];
    var name = row[0];
    var year = row[1];
    title_el.textContent = year ? name + ' (' + year + ')' : name;
}

function setup_chart() {
    var chart_el = document.getElementById('chart');
    var ctx = chart_el.getContext('2d');
    show_chart = new Chart(ctx, {
        type: 'line',
        options: {
            responsive: true,
            maintainAspectRatio: true,
            aspectRatio: window.innerWidth < 768 ? 1 : 2,
            tooltips: {
                callbacks: {
                    title: function(tooltipItems, data) {
                        if (!tooltipItems.length) {
                            return '';
                        }
                        var item = tooltipItems[0];
                        return data.labels[item.index] || '';
                    },
                    label: function(tooltipItem, data) {
                        var dataset = data.datasets[tooltipItem.datasetIndex];
                        var point = dataset.data[tooltipItem.index];
                        if (dataset.label === 'Show rating') {
                            return dataset.label + ': ' + tooltipItem.yLabel;
                        }
                        var name = point && point.name ? point.name : 'Episode';
                        return name + ' (Score: ' + tooltipItem.yLabel + ')';
                    },
                    footer: function(tooltipItems, data) {
                        if (!tooltipItems.length) {
                            return '';
                        }
                        var item = tooltipItems[0];
                        var dataset = data.datasets[item.datasetIndex];
                        var point = dataset.data[item.index];
                        if (!point || !point.episodeId) {
                            return '';
                        }
                        return 'https://www.imdb.com/title/' + point.episodeId + '/';
                    }
                }
            },
            legend: {
                position: 'bottom',
                labels: {
                    boxWidth: window.innerWidth < 768 ? 20 : 40,
                    fontSize: window.innerWidth < 768 ? 10 : 12
                }
            },
            scales: {
                yAxes: [{
                    ticks: {
                        beginAtZero: true
                    }
                }]
            }
        },
        onClick: function(event, activeElements) {
            if (!activeElements.length) {
                return;
            }
            var element = activeElements[0];
            var dataset = show_chart.data.datasets[element._datasetIndex];
            var point = dataset.data[element._index];
            if (point && point.episodeId) {
                var url = 'https://www.imdb.com/title/' + point.episodeId + '/';
                window.open(url, '_blank', 'noopener');
            }
        }
    });
}

function update_chart(show_id) {
    if (!db) {
        console.error('Database not loaded');
        return;
    }

    window.location.hash = show_id;

    try {
        var show_rating = null;
        var rating_results = db.exec(
            'SELECT rating FROM shows WHERE id = ? LIMIT 1',
            [show_id]
        );
        if (rating_results.length && rating_results[0].values.length) {
            show_rating = rating_results[0].values[0][0];
        }

        // Query episodes for this show
        const results = db.exec(`
            SELECT season, episode_number, score, name
            FROM episodes
            WHERE parent_id = ?
            ORDER BY season, episode_number
        `, [show_id]);

        if (results.length === 0) {
            document.querySelector('h1').textContent = 'Show not found';
            return;
        }

        // Process results into seasons structure
        const show = {};
        const episodes = results[0].values;

        episodes.forEach(([season, episode_num, score, name]) => {
            if (!(season in show)) {
                show[season] = [];
            }
            show[season].push({
                episode_number: episode_num,
                score: score,
                name: name
            });
        });

        // Update chart
        show_chart.data.datasets = [];
        let max_episodes = 0;
        const seasons_list = Object.keys(show).sort((a, b) => a - b);
        const color_step = 360 / seasons_list.length;

        seasons_list.forEach((season_no, index) => {
            const season = show[season_no];
            const points = season.map(ep => ({
                y: ep.score,
                episodeId: ep.id,
                name: ep.name
            }));

            if (points.length > max_episodes) {
                max_episodes = points.length;
            }

            const hue = color_step * index;

            show_chart.data.datasets.push({
                label: "Season " + season_no,
                data: points,
                borderColor: `hsl(${hue}, 70%, 70%)`,
                fill: false
            });
        });

        const labels = [];
        for (let i = 1; i <= max_episodes; i++) {
            labels.push("Episode " + i);
        }

        if (show_rating !== null) {
            show_chart.data.datasets.push({
                label: "Show rating",
                data: labels.map(() => show_rating),
                borderColor: "#333",
                borderDash: [6, 6],
                fill: false
            });
        }

        show_chart.data.labels = labels;
        show_chart.update();

        // Update title - get show name from any episode
        update_show_title(show_id);

    } catch (error) {
        console.error('Error querying database:', error);
        document.querySelector('h1').textContent = 'Error loading show data';
    }
}

function handle_search_submit(event) {
    event.preventDefault();
    var input = document.getElementById('show_search');
    if (!input) {
        return;
    }
    var query = input.value.trim();
    if (!query) {
        return;
    }
    if (/^tt\d+$/.test(query)) {
        update_chart(query);
        render_show_results([], '');
        return;
    }
    var results = search_shows_by_name(query);
    last_search_term = query;
    render_show_results(results, query);
    if (results.length === 1) {
        update_chart(results[0].id);
    }
}

function handle_search_input(event) {
    if (!db) {
        return;
    }
    var query = event.target.value.trim();
    if (search_timer) {
        clearTimeout(search_timer);
    }
    search_timer = setTimeout(function() {
        if (!query) {
            render_show_results([], '');
            return;
        }
        if (/^tt\d+$/.test(query)) {
            render_show_results([], '');
            return;
        }
        var results = search_shows_by_name(query);
        last_search_term = query;
        render_show_results(results, query);
    }, 200);
}

setup_chart();
initDatabase().then(() => {
    var form = document.getElementById('show_form');
    if (form) {
        form.addEventListener('submit', handle_search_submit);
    }
    var input = document.getElementById('show_search');
    if (input) {
        input.addEventListener('input', handle_search_input);
    }
    window.addEventListener('hashchange', function() {
        var show_id = get_show_id();
        if (show_id) {
            update_chart(show_id);
        }
    });
    var show_id = get_show_id();
    if (show_id) {
        update_chart(show_id);
    }
}).catch(function(error) {
    var title = document.querySelector('h1');
    if (title) {
        title.textContent = 'Failed to load database';
    }
    console.error(error);
});
