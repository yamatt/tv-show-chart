var show_chart = null;

function get_show_id() {
    //https://stackoverflow.com/questions/901115/how-can-i-get-query-string-values-in-javascript
    var url_params = new URLSearchParams(window.location.search);
    var show_id = url_params.get('id');
    return show_id;
}

function get_data_url(show_id) {
    return '/data/' + show_id + ".data"
}

function data_to_object(text) {
    show = {}
    var seasons = text.split("\n")
    for(var season in seasons){
        episodes = seasons[season].split("\t");
        season_no = episodes.shift();
        for(var episode in episodes) {
            episode_data = episodes[episode].split(":");
            if (show[season_no] === undefined) {
                show[season_no] = []
            }
            show[season_no].push({
                "id": episode_data[0],
                "score": episode_data[1]
            })
        }
    }
    return show;
}


function setup_chart() {
    //https://jsfiddle.net/vu6qs83d/
    var chart_el = document.getElementById('chart');
    var ctx = chart_el.getContext('2d');
    show_chart = new Chart(ctx, {
        type: 'line',
        options: {
             legend: {
                position: 'bottom'
             },
            scales: {
                yAxes: [{
                    ticks: {
                        beginAtZero: true
                    }
                }]
            }
        }
    });
}

function update_chart(show_id) {
    fetch(get_data_url(show_id))
    .then(function(response) {
        if (!response.ok) {
            throw new Error("HTTP error, status = " + response.status);
        }
        return response.text().then(function(text) {
            return data_to_object(text);
        })
    })
    .then(function(show) {
        show_chart.data.datasets = [];
        var max_episodes = 0;
        var colour_step = 360 / Object.keys(show).length;

        for(var season_no in show) {
            var season = show[season_no];

            var scores = []

            if (season.length > max_episodes) {
                max_episodes = season.length
            }

            for (var episode_i in season) {
                var episode = season[episode_i]

                scores.push(episode.score)
            }

            var hue = colour_step * season_no;

            show_chart.data.datasets.push({
                label: "Season " + season_no,
                data: scores,
                borderColor: "hsl(" + hue + ",70% ,70%)",
                fill: false
            })
        }

        labels = []
        for(var i=1; i <= max_episodes; i++) {
            labels.push("Episode " + i);
        }

        show_chart.data.labels = labels;
        show_chart.update();
    })
    .catch(function(error) {
        console.log(error);
    });
}
setup_chart();
update_chart(get_show_id());
