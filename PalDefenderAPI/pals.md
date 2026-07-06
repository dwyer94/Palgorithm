Beta

**Endpoint:** `GET /v1/pdapi/pals/<player_identifier>`

**Auth:** Bearer token

**Permission:** `REST.Pals.Read`

Purpose
-------

Lists the target player's Pals. Pal identifiers in responses can be searched on [paldeck.cc/pals](https://paldeck.cc/pals).

Path parameters
---------------

* `player_identifier`: `UserId` or `PlayerUID` for the target player.

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

Target player metadata and Pal counts.

`Pals`

object

Team, Palbox, and base camp Pals for the target player.

`Meta` object schema:

Field

Type

Description

`PlayerUID`

string

Player UID used by Palworld save data.

`Player`

string

Player identifier supplied in the request path.

`TeamCount`

integer

Number of Pals in the player team.

`PalboxCount`

integer

Number of Pals in the player Palbox.

`BaseCampCount`

integer

Number of base camps included.

`Pals` object schema:

Field

Type

Description

`Team`

object

Team Pals keyed by Pal instance ID.

`Palbox`

object

Palbox Pals keyed by Pal instance ID.

`BaseCamps`

object\[\]

Guild base camps and their assigned worker Pals.

Pal object schema:

Field

Type

Description

`PalID`

string

Pal species identifier.

`UniqueNPCID`

string

Unique NPC ID, when present.

`Nickname`

string

Custom Pal nickname, or an empty string.

`SkinId`

string

Skin ID, or an empty string.

`Gender`

string

Pal gender.

`Level`

integer

Pal level.

`Exp`

integer

Pal EXP.

`Shiny`

boolean

Whether this is a rare Pal.

`PartnerSkillLevel`

integer

Partner skill rank.

`CondensedPals`

integer

Condense rank progress.

`UnusedStatusPoints`

integer

Unused Pal status points.

`FriendshipPoints`

integer

Friendship point value.

`PhysicalHealth`

string

Physical health state.

`WorkerSick`

string

Worker sickness state.

`ImportedCharacter`

boolean

Whether this is marked as imported.

`HP`

number

Current HP.

`MP`

number

Current MP, when present.

`SP`

number

Current stamina, when present.

`Shield`

number

Current shield value, when present.

`Hunger`

number

Current hunger value.

`MaxHunger`

number

Maximum hunger value.

`SAN`

number

Sanity value.

`Support`

integer

Support value.

`CraftSpeed`

integer

Craft speed value.

`PalSouls`

object

Pal soul ranks with `Health`, `Attack`, `Defense`, and `CraftSpeed`.

`IVs`

object

IV values with `Health`, `AttackMelee`, `AttackShot`, and `Defense`.

`ActiveSkills`

string\[\]

Equipped active skills.

`LearntSkills`

string\[\]

Learned skills.

`Passives`

string\[\]

Passive skill IDs.

`ExtraWorkSuitabilities`

object

Additional work suitability ranks keyed by suitability ID.

`DisableWorkPreferences`

string\[\]

Disabled work preference IDs.

`team_slot_index`

integer

Team slot index, only on `Team` Pals.

`page`

integer

Palbox page index, only on `Palbox` Pals.

`slot`

integer

Palbox slot index, only on `Palbox` Pals.

`base_camp_slot_index`

integer

Base camp worker slot index, only on base camp Pals.

`BaseCamps[]` item schema:

Field

Type

Description

`id`

string

Base camp GUID.

`level`

integer

Base camp level.

`world_pos`

object

Base camp world coordinates.

`map_pos`

object

Converted map coordinates.

`state`

string

Current base camp state.

`pals`

object

Base camp worker Pals keyed by Pal instance ID.

Coordinate object schema:

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

`404`

`PLAYER_NOT_FOUND`

No online player matched the supplied `player_identifier`.

`404`

`PLAYER_STATE_NOT_FOUND`

The player exists, but their `APalPlayerState` was unavailable.
