( function ( $, L, prettySize ) {
	var map, heat,
		heatOptions = {
			tileOpacity: 1,
			heatOpacity: 0.5,
			radius: 25,
			blur: 15
		};
	var latMax = -Number.MAX_VALUE;
	var longMax = -Number.MAX_VALUE;
	var latMin = Number.MAX_VALUE;
	var longMin = Number.MAX_VALUE;

	// Start at the beginning
	stageOne();

	function stageOne () {
		var dropzone;

		// Initialize the map
		map = L.map( 'map' ).setView([0,0], 2);
		// map = L.map( 'map' ).setView([50,50], 9);
		L.tileLayer( 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
			attribution: 'location-history-visualizer is open source and available <a href="https://github.com/theopolisme/location-history-visualizer">on GitHub</a>. Map data &copy; <a href="https://openstreetmap.org">OpenStreetMap</a> contributors.',
			maxZoom: 18,
			minZoom: 2
		} ).addTo( map );

		// Initialize the dropzone
		dropzone = new Dropzone( document.body, {
			url: '/',
			previewsContainer: document.createElement( 'div' ), // >> /dev/null
			clickable: false,
			accept: function ( file, done ) {
				stageTwo( file );
				dropzone.disable(); // Your job is done, buddy
			}
		} );

		// For mobile browsers, allow direct file selection as well
		$( '#file' ).change( function () {
			stageTwo( this.files[0] );
			dropzone.disable();
		} );
	}

	function stageTwo ( file ) {
		heat = L.heatLayer( [], heatOptions ).addTo( map );

		// First, change tabs
		$( 'body' ).addClass( 'working' );
		$( '#intro' ).addClass( 'hidden' );
		$( '#working' ).removeClass( 'hidden' );

		// Now start working!
		processFile( file );

		function status ( message ) {
			$( '#currentStatus' ).text( message );
		}

		function processFile ( file ) {
			var fileSize = prettySize( file.size ),
				reader = new FileReader();

			status( 'Preparing to import file (' + fileSize + ')...' );

			function getLocationDataFromJson ( data ) {
				var SCALAR_E7 = 0.0000001, // Since Google Takeout stores latlngs as integers
					locations = JSON.parse( data ).locations;

				if ( !locations || locations.length === 0 ) {
					throw new ReferenceError( 'No location data found.' );
				}

				return locations.map( function ( location ) {
					return [ location.latitudeE7 * SCALAR_E7, location.longitudeE7 * SCALAR_E7 ];
				} );
			}

			function getLocationDataFromKml ( data ) {
				var KML_DATA_REGEXP = /<when>(.*?)<\/when>\s*<gx:coord>(\S*)\s(\S*)\s(\S*)<\/gx:coord>/g,
					locations = [],
					match = KML_DATA_REGEXP.exec( data );

				// match
				//  [1] ISO 8601 timestamp
				//  [2] longitude
				//  [3] latitude
				//  [4] altitude (not currently provided by Location History)

				while ( match !== null ) {
					locations.push( [ Number( match[3] ), Number( match[2] ) ] );
					match = KML_DATA_REGEXP.exec( data );
				}

				return locations;
			}

			// Heatpoint frequency check
			function getHeatPoints ( locations, num) {
				var frequencyTable = new Array();
				var locationLength = locations.length;
				for (var i = 0; i < locationLength; i++) {
					var newCoord = (Number(locations[i][0]).toFixed(4)).concat(',').concat(Number(locations[i][1]).toFixed(4));
					if (newCoord in frequencyTable) {
						frequencyTable[newCoord]++;
					} else {
						frequencyTable[newCoord] = 1;
					}
				}
				var keys = []; for(var key in frequencyTable) keys.push(key);
    			return keys.sort(function(a,b){return frequencyTable[b]-frequencyTable[a]}).slice(0,num);
			}

			// Draw top visiting locations on map
			// Fix zoom configuration
			function getFrequencyMarker(freqList) {
				var listLength = freqList.length;
				for (var i = 0; i < listLength; i++) {
					var curCoord = freqList[i].split(',');
					var curLat = Number(curCoord[0]);
					var curLong = Number(curCoord[1]);
					var marker = L.marker([curLat, curLong]).addTo(map);
					if (curLat > latMax) latMax = curLat;
					if (curLat < latMin) latMin = curLat;
					if (curLong > longMax) longMax = curLong;
					if (curLong < longMin) longMin = curLong;
				}
			}

			reader.onprogress = function ( e ) {
				var percentLoaded = Math.round( ( e.loaded / e.total ) * 100 );
				status( percentLoaded + '% of ' + fileSize + ' loaded...' );
			};

			reader.onload = function ( e ) {
				var latlngs;

				status( 'Generating map...' );

				try {
					if ( /\.kml$/i.test( file.name ) ) {
						latlngs = getLocationDataFromKml( e.target.result );
					} else {
						latlngs = getLocationDataFromJson( e.target.result );
					}
				} catch ( ex ) {
					status( 'Something went wrong generating your map. Ensure you\'re uploading a Google Takeout JSON file that contains location data and try again, or create an issue on GitHub if the problem persists. (error: ' + ex.message + ')' );
					return;
				}

				heat._latlngs = latlngs;

				
				getFrequencyMarker(getHeatPoints(latlngs, 20));

				heat.redraw();
				stageThree( /* numberProcessed */ latlngs.length );
			};

			reader.onerror = function () {
				status( 'Something went wrong reading your JSON file. Ensure you\'re uploading a "direct-from-Google" JSON file and try again, or create an issue on GitHub if the problem persists. (error: ' + reader.error + ')' );
			};

			reader.readAsText( file );
		}
	}

	function stageThree ( numberProcessed ) {
		var $done = $( '#done' );
		
		
		// Change tabs :D
		$( 'body' ).removeClass( 'working' );
		$( '#working' ).addClass( 'hidden' );
		$done.removeClass( 'hidden' );

		// Update count
		$( '#numberProcessed' ).text( numberProcessed.toLocaleString() );

		// Fade away when clicked
		$done.one( 'click', function () {
			$( 'body' ).addClass( 'map-active' );
			$done.fadeOut();

			// TODO: autozoom
			// map.fitBounds([[40.712, -74.227],[40.774, -74.125]]);
			map.fitBounds([[latMin, longMin], [latMax, longMax]]);
			activateControls();
		} );

		function activateControls () {
			var $tileLayer = $( '.leaflet-tile-pane' ),
				$heatmapLayer = $( '.leaflet-heatmap-layer' ),
				originalHeatOptions = $.extend( {}, heatOptions ); // for reset

			// Update values of the dom elements
			function updateInputs () {
				var option;
				for ( option in heatOptions ) {
					if ( heatOptions.hasOwnProperty( option ) ) {
						document.getElementById( option ).value = heatOptions[option];
					}
				}
			}

			updateInputs();

			$( '.control' ).change( function () {
				switch ( this.id ) {
					case 'tileOpacity':
						$tileLayer.css( 'opacity', this.value );
						break;
					case 'heatOpacity':
						$heatmapLayer.css( 'opacity', this.value );
						break;
					default:
						heatOptions[ this.id ] = Number( this.value );
						heat.setOptions( heatOptions );
						break;
				}
			} );

			$( '#reset' ).click( function () {
				$.extend( heatOptions, originalHeatOptions );
				updateInputs();
				heat.setOptions( heatOptions );
				// Reset opacity too
				$heatmapLayer.css( 'opacity', originalHeatOptions.heatOpacity );
				$tileLayer.css( 'opacity', originalHeatOptions.tileOpacity );
			} );
		}
	}

}( jQuery, L, prettysize ) );
