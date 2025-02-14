import React, {useCallback, useEffect, useState} from 'react';
import Client from 'twilio-chat';
import {Channel} from 'twilio-chat/lib/channel';
import {
  Button, Tabs, Tab, TabList, TabPanels, TabPanel, Menu,
  MenuButton, MenuList, MenuOptionGroup, MenuItemOption, Flex, Box, Spacer, useToast,
} from "@chakra-ui/react";
import {CloseIcon} from '@chakra-ui/icons'
import {saveAs} from 'file-saver';

import useCoveyAppState from "../../hooks/useCoveyAppState";
import ChatScreen from "./ChatScreen";
import Player from "../../classes/Player";
import useNearbyPlayers from "../../hooks/useNearbyPlayers";

/**
 * ChannelWrapper manages channels. It takes in the chat token to generate a client,
 * which is used for channel management.
 * @param chatToken the token used to create the Chat Client
 * @returns A React Component that displays the full chat window
 */
export default function ChannelWrapper({chatToken}: { chatToken: string }): JSX.Element {
  const [client, setClient] = useState<Client>();
  const [loading, setLoading] = useState<boolean>(false);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [tabIndex, setTabIndex] = useState(0);
  const [isHelped, setIsHelped] = useState<boolean>(false);
  const [mainChannel, setMainChannel] = useState<Channel>();
  const {
    currentTownID,
    currentTownFriendlyName,
    players,
    userName,
    myPlayerID,
    apiClient,
    socket
  } = useCoveyAppState();

  const [privateChannels, setPrivateChannels] = useState<string[]>([]);
  const toast = useToast();

  const handleTabsChange = useCallback((index) => {
    setTabIndex(index);

  }, []);

  // checks if channel already exists, then adds to channels array if not already exists.
  const addChannel = useCallback((newChannel: Channel) => {
    const exists = channels.find(each => each.uniqueName === newChannel.uniqueName);
    if (!exists) {
      setChannels(old => [...old, newChannel]);
    }
  }, [channels]);

  const leaveChannel = async (uniqueName: string) => {
    if (client) {
      const remainingChannels = channels.filter(channel1 => channel1.uniqueName !== uniqueName);
      setChannels(remainingChannels);
      setTabIndex(0);
      const channel = await client.getChannelByUniqueName(uniqueName);
      await channel.sendMessage(`${userName} has left the chat.`);
      await channel.leave();
    }
  };

  // handle closing a private message
  const handleCloseButtonPrivateMessage = async (otherPlayer: { playerID: string; }, currentPlayer: { playerID: string; }, uniqueName: string) => {
    // Ensure that both players are removed from each other's list for private messages
    const newPrivateChannels = privateChannels.filter(player => (![otherPlayer.playerID,
      currentPlayer.playerID].includes(player)));

    setPrivateChannels(newPrivateChannels);
    await leaveChannel(uniqueName);
  };

  // Handler for channel events
  const handleChannelEvents = useCallback(async (channelClient: Client) => {

    channelClient.on('channelInvited', async (channel: Channel) => {
      // Join the channel that you were invited to
      await channel.join();
      await channel.sendMessage(`${userName} joined the chat.`);
      const getFirstMessage = await channel.getMessages();

      // Relies on the idea that the first message comes from the inviting user!
      setPrivateChannels(oldUsers => [...oldUsers,
        JSON.parse(getFirstMessage.items[0].author).playerID]);
      setChannels(oldChannels => [...oldChannels, channel])
    });

    channelClient.on('channelLeft', async () => {
      setTabIndex(0);
    });

    channelClient.on('channelRemoved', async () => {
      setTabIndex(0);
    });

  }, [userName]);

  const createPrivateChannelWithBot = async () => {
    setLoading(true);
    await apiClient.createChatBotChannel({
      playerID: myPlayerID,
      coveyTownID: currentTownID,
    })
    setTabIndex(channels.length)
    setIsHelped(true);
    setLoading(false);
  };


  useEffect(() => {
    const logIn = async () => {
      setLoading(true);
      try {

        const newClient = await Client.create(chatToken);

        setClient(newClient);

        setLoading(false);
      } catch (error) {
        throw new Error(`Unable to create client for ${currentTownFriendlyName}: \n${error}`);
      }
    };
    logIn();
    return () => {
    };

  }, [chatToken, currentTownFriendlyName]);

  useEffect(() => {
    const listen = () => {
      if (client) {
        handleChannelEvents(client);
      }
    };

    listen();

    return (() => {
    });
  }, [client, handleChannelEvents]);

  useEffect(() => {
    const disconnect = () => {
      if (socket && mainChannel) {
        socket.on("disconnect", async () => {
          try {
            await mainChannel.sendMessage(`${userName} has left the chat`);
          } catch {
            setLoading(true);
          }

        });
      }

    };

    disconnect();

    return (() => {
    });
  }, [socket, mainChannel, client, userName]);


  useEffect(() => {
    const login = async () => {

      try {
        // prevents rest of function from firing off again
        // if not check channels.length, join message will send twice!
        if (client && channels.length === 0) {

          const main = await client.getChannelByUniqueName(currentTownID);
          setMainChannel(main);

          if (mainChannel) {
            if (mainChannel.status !== "joined") {
              await mainChannel.join();
            }
            addChannel(mainChannel);
            await mainChannel.sendMessage(`${userName} has joined the main chat`);
          }
        }
      } catch (error) {
        throw new Error(`Unable to join channel for town ${error}`);
      }
    };

    login();

    return (() => {

    });
  }, [client, currentTownID, channels, addChannel, mainChannel, userName]);


  // the purpose of the function is to check if two players are both in the players list
  const checkPlayersExistence = (otherPlayer: { playerID: string; }, currentPlayer: { playerID: string; }) => {

    const filtered = players.filter(player => player.id === otherPlayer.playerID ||
      player.id === currentPlayer.playerID);

    return filtered.length >= 2;
  };

  const filteredChannelList = () => {
    const listToFilter: Channel[] = [];
    channels.map(channel => {
      const {friendlyName} = channel;
      try {
        const {
          players: {
            currentPlayer,
            otherPlayer,
          }
        } = JSON.parse(friendlyName);
        if (checkPlayersExistence(currentPlayer, otherPlayer)) {
          listToFilter.push(channel)
        }
      } catch {
        listToFilter.push(channel)
      }
      return listToFilter;
    });
    return listToFilter;
  };

  const leaveHelpChannel = (uniqueName: string) => {
    setIsHelped(false);
    leaveChannel(uniqueName)
  }


  // Renders channels tabs based on channels array.
  const renderTabs = (filteredChannelList()).map(channel => {
    const {friendlyName, uniqueName} = channel;

    let tabName;
    try {
      const {
        players: {
          currentPlayer,
          otherPlayer,
        }
      } = JSON.parse(friendlyName);
      if (currentPlayer.userName !== userName) {
        tabName = currentPlayer.userName;
      } else {
        tabName = otherPlayer.userName;
      }

      return (
        <Tab key={uniqueName} _selected={{bg: "#57c994"}}>
          {`Private Message with ${tabName}`} <CloseIcon
          onClick={() => handleCloseButtonPrivateMessage(otherPlayer, currentPlayer, uniqueName)}/>
        </Tab>
      );

    } catch {
      return friendlyName === myPlayerID ? (
        <Tab key={uniqueName} _selected={{bg: "#57c994"}}>
          Help <CloseIcon onClick={() => leaveHelpChannel(uniqueName)}/>
        </Tab>
      ) : (
        <Tab key={uniqueName} _selected={{bg: "#57c994"}}>
          Town Chat
        </Tab>
      );
    }

  });
  // Renders each channel's chat screen.
  const renderTabScreens = (filteredChannelList()).map(channel => {
    const {uniqueName} = channel;

    return (
      <TabPanel p={50} key={uniqueName} bg="#57c994">
        <ChatScreen channel={channel}/>
      </TabPanel>
    )
  });


  const createPrivateChannelFromMenu = async (currentPlayerID: string, playerToPM: Player) => {

    setPrivateChannels(oldUsers => [...oldUsers, playerToPM.id]);
    await apiClient.createPrivateChatChannel({
      currentPlayerID,
      otherPlayerID: playerToPM.id,
      coveyTownID: currentTownID
    });
  };

  // filter the player list to only show people not the current player
  const filteredPlayerList = useNearbyPlayers().nearbyPlayers.filter(player =>
    !privateChannels.includes(player.id));

  const renderPrivateMessageList = filteredPlayerList.map(player => (
    <MenuItemOption key={player.id} value={player.id}
                    onClick={() => {
                      createPrivateChannelFromMenu(myPlayerID, player)
                    }}>{player.userName}</MenuItemOption>
  ));

  const getTownChatLogs = async () => {
    if (client && mainChannel) {

      // get the channel, the messages and create a chatLog array
      const messages = await mainChannel.getMessages();
      const chatLog: BlobPart[] | undefined = [];

      // fill the array with formatted messages
      messages.items.map(message => (
        chatLog.push(
          `${message.dateCreated}: ${JSON.parse(message.author).userName}:${message.body}\n`
        )
      ));
      // make a blob of the array, and save it.
      const blob = new Blob(chatLog, {type: "text/plain;charset=utf-8"});
      saveAs(blob, `Town_Chat_Logs.txt`);

      toast({
        title: `Downloaded Town Chat Logs`,
        status: 'success',
        isClosable: true,
        duration: null,
      })
    }
  };

  return (
    <>
      <Tabs isManual index={tabIndex} onChange={handleTabsChange} variant='enclosed'>
        <TabList>
          {renderTabs}
        </TabList>
        <TabPanels>
          {renderTabScreens}
        </TabPanels>
      </Tabs>
      <Flex>
        <Box>
          <Menu placement="top">
            <MenuButton as={Button} colorScheme="teal">
              Private Message
            </MenuButton>
            <MenuList minWidth="240px" maxHeight="400px" overflow="auto">
              <MenuOptionGroup title="Select User To Private Message">
                {renderPrivateMessageList}
              </MenuOptionGroup>
            </MenuList>
          </Menu>
        </Box>
        <Spacer/>
        <Button onClick={getTownChatLogs} colorScheme="teal" marginRight="1">
          Logs
        </Button>
        <Button
          colorScheme="teal"
          isLoading={loading}
          loadingText="Getting Help..."
          onClick={createPrivateChannelWithBot}
          isDisabled={isHelped}>
          Help
        </Button>
      </Flex>
    </>

  )
}
