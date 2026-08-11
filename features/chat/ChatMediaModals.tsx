import { Ionicons } from "@expo/vector-icons";
import { ResizeMode, Video } from "expo-av";
import { Image, Modal, TouchableOpacity, View } from "react-native";
import { styles } from "./chatStyles";

export function ChatMediaModals({
  imageUrl,
  videoUrl,
  onCloseImage,
  onCloseVideo,
}: {
  imageUrl: string | null;
  videoUrl: string | null;
  onCloseImage: () => void;
  onCloseVideo: () => void;
}) {
  return (
    <>
      <Modal
        visible={imageUrl !== null}
        transparent
        animationType="fade"
        onRequestClose={onCloseImage}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={onCloseImage}
        >
          <Image
            source={{ uri: imageUrl || "" }}
            style={styles.modalImage}
            resizeMode="contain"
          />
          <TouchableOpacity style={styles.modalCloseBtn} onPress={onCloseImage}>
            <Ionicons name="close" size={32} color="#FFF" />
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
      <Modal
        visible={videoUrl !== null}
        animationType="slide"
        onRequestClose={onCloseVideo}
      >
        <View style={styles.videoModal}>
          <TouchableOpacity style={styles.modalCloseBtn} onPress={onCloseVideo}>
            <Ionicons name="close" size={32} color="#FFF" />
          </TouchableOpacity>
          {videoUrl ? (
            <Video
              source={{ uri: videoUrl }}
              style={styles.fullVideo}
              useNativeControls
              shouldPlay
              resizeMode={ResizeMode.CONTAIN}
            />
          ) : null}
        </View>
      </Modal>
    </>
  );
}
