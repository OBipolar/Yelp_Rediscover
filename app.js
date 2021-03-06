( function ( $, L, prettySize ) {
	var map, heat,
		heatOptions = {
			tileOpacity: 0.5,
			heatOpacity: 1.0,
			radius: 10,
			blur: 5
		};
	// var authData = JSON.parse(authData);
	// console.log(authData);
	

	var auth = {
		//
		// Update with your Yelp auth tokens.
		//
		consumerKey : "#####",
		consumerSecret : "#####",
		accessToken : "#####",
		accessTokenSecret : "#####",
		serviceProvider : {
			signatureMethod : "HMAC-SHA1"
		}
	}
	var spotList = new Array();
	var spotInfo = [];

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

			function getSpotMarker(spotData) {
				var len = spotData.length;
				for (var i = 0; i < len; i++) {
					var name = spotData[i].name;
					if (!(name in spotList)) {
						var curLat = spotData[i].location.coordinate.latitude;
						var curLong = spotData[i].location.coordinate.longitude;
						var name = spotData[i].name;
						var rating = spotData[i].rating;
						var address = spotData[i].location.address;
						var url = spotData[i].url;
						var imgUrl = spotData[i].image_url;
						var marker = L.marker([curLat, curLong]);
						marker.bindPopup("<b>" + name + "</b><br>Raring:" + rating + "<br>" + address).openPopup();
						marker.addTo(map);
						var details = {bizName: name, bizRating: rating, bizAdd: address, bizUrl: url, bizImg: imgUrl.replace("ms.jpg","ls.jpg")};
						spotInfo.push(details);
						spotList[name] = 0;
					}
				} 
			}

			function getYelpInfo(curLat, curLong) {
				var info;
				var terms = 'food';
				var accessor = {
					consumerSecret : auth.consumerSecret,
					tokenSecret : auth.accessTokenSecret
				};
				parameters = [];
				parameters.push(['term', terms]);
				parameters.push(['sort', '2']);
				parameters.push(['limit', '5']);				
				parameters.push(['ll', curLat +','+ curLong]);
				parameters.push(['callback', 'cb']);
				parameters.push(['radius_filter', '800']);
				parameters.push(['oauth_consumer_key', auth.consumerKey]);
				parameters.push(['oauth_consumer_secret', auth.consumerSecret]);
				parameters.push(['oauth_token', auth.accessToken]);
				parameters.push(['oauth_signature_method', 'HMAC-SHA1']);
				var message = {
					'action' : 'http://api.yelp.com/v2/search',
					'method' : 'GET',
					'parameters' : parameters
				};
				OAuth.setTimestampAndNonce(message);
				OAuth.SignatureMethod.sign(message, accessor);
				var parameterMap = OAuth.getParameterMap(message.parameters);
				parameterMap.oauth_signature = OAuth.percentEncode(parameterMap.oauth_signature)
				$.ajax({
					'url' : message.action,
					'data' : parameterMap,
					'cache' : true,
					'dataType' : 'jsonp',
					'jsonpCallback' : 'cb',
					'success' : function(data, textStats, XMLHttpRequest) {
						getSpotMarker(data['businesses']);
					}
				});
				// return(info);
			}

			// Draw top visiting locations on map
			// Fix zoom configuration
			function getFrequencyMarker(freqList) {
				var listLength = freqList.length;
				for (var i = 0; i < listLength; i++) {
					var curCoord = freqList[i].split(',');
					var curLat = Number(curCoord[0]);
					var curLong = Number(curCoord[1]);
					getYelpInfo(curLat, curLong);
					// var marker = L.marker([curLat, curLong]).addTo(map);
					var circle = L.circle([curLat, curLong], 800, {
    					color: 'red',
    					fillColor: '#f03',
    					fillOpacity: 0.2
					}).addTo(map);
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

				
				getFrequencyMarker(getHeatPoints(latlngs, 30));

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
		// Also add spot info listview
		$done.one( 'click', function () {
			var sidebar;
			$( 'body' ).addClass( 'map-active' );
			$done.fadeOut();

			map.fitBounds([[latMin, longMin], [latMax, longMax]]);
			
			$('body').css({
    			'padding-right': '250px'
  			});
  			sidebar = $(populateSidebar());
			sidebar.css({
				'position': 'fixed',
			    'right': '0px',
			    'top': '0px',
			    'z-index': 9999,
			    'width': '250px',
			    'height': '100%',
			    'overflow-y':'auto',
			    'background-color': 'white'  // Confirm it shows up
			});
			$('body').append(sidebar); 
			console.log(spotInfo);
			activateControls();
		} );

		function populateSidebar () {
			var divContent = "<div id='sidebar'>";
			var len = spotInfo.length;
			for (var i = 0; i < len; i++) {
				divContent = divContent + '<div class="card"><div class="card-image"><a href=' + spotInfo[i].bizUrl + '><img src='+spotInfo[i].bizImg+'></a><h3>'+spotInfo[i].bizName+'</h3></div>';

				divContent = divContent + '<p>Rating:'+ spotInfo[i].bizRating +'</p><p>' + spotInfo[i].bizAdd+'</p></div>';  
			}
			divContent = divContent + "</div>";
			return divContent;
		}

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
				$heatmapLayer.css( 'opacity', originalHeatOptions.heatOpacity );
				$tileLayer.css( 'opacity', originalHeatOptions.tileOpacity );
			} );
		}
	}

}( jQuery, L, prettysize ) );
