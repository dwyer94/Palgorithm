Beta

**Endpoint:** `GET /v1/pdapi/players`

**Auth:** Bearer token

**Permission:** `REST.Players.Read`

Purpose
-------

Lists known players with identifying and status information. Use it to build player selectors for admin tools.

Path parameters
---------------

None.

Query parameters
----------------

None.

Request body
------------

No request body.

Response schema
---------------

### 200 response schema

Field

Type

Description

`Meta`

object

Player list counts.

`Players`

object\[\]

Known players with identifying, guild, status, and location information.

`Meta` object schema:

Field

Type

Description

`PlayerCount`

integer

Number of player accounts returned.

`OnlineCount`

integer

Number of returned players currently online.

`Players[]` item schema:

Field

Type

Description

`Name`

string

Current or saved player name.

`IP`

string

Player IP address, or an empty string when unavailable.

`PlayerUID`

string

Player UID used by Palworld save data.

`UserId`

string

Platform user ID, or an empty string when unavailable.

`GuildName`

string

Guild name, or an empty string when unavailable.

`GuildUUID`

string

Guild UUID, or a zero GUID when unavailable.

`Status`

string

Saved player account state.

`WorldLocation`

object

Current or last saved world coordinates.

`MapLocation`

object

Converted map coordinates.

Location object schema:

Field

Type

Description

`x`

number

X coordinate.

`y`

number

Y coordinate.

`z`

number

Z coordinate.

Error responses
---------------

Error bodies use this shape:

`[](#__codelineno-0-1){     [](#__codelineno-0-2)    "Error": {        [](#__codelineno-0-3)        "Code": "ERROR_CODE",        [](#__codelineno-0-4)        "Message": "Human-readable message",        [](#__codelineno-0-5)        "Details": {}    [](#__codelineno-0-6)    } [](#__codelineno-0-7)}`

HTTP

Error code

When it happens

`401`

`INVALID_TOKEN`

The `Authorization` header is missing, malformed, or does not match a configured bearer token.

`403`

`MISSING_PERMISSION`

The token is valid, but it does not include this endpoint permission.

`400`

`INVALID_JSON`

A request body was supplied, but it could not be parsed as JSON.

`400`

`REQUEST_FAILED`

The game-thread callback threw an exception, or a shared player/resource resolver failed.

`500`

`REQUEST_TIMEOUT`

The internal game-thread callback did not complete within 5 seconds.

`500`

`PLAYER_MANAGER_UNAVAILABLE`

The server could not access the Palworld player manager.
