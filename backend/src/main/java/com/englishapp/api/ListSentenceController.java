package com.englishapp.api;

import com.englishapp.service.CurrentUserService;
import com.englishapp.service.ListSentenceService;
import com.englishapp.service.SentenceVideoLinkService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api")
public class ListSentenceController {
    private final CurrentUserService currentUserService;
    private final ListSentenceService listSentenceService;
    private final SentenceVideoLinkService sentenceVideoLinkService;

    public ListSentenceController(CurrentUserService currentUserService, ListSentenceService listSentenceService, SentenceVideoLinkService sentenceVideoLinkService) {
        this.currentUserService = currentUserService;
        this.listSentenceService = listSentenceService;
        this.sentenceVideoLinkService = sentenceVideoLinkService;
    }

    @GetMapping("/lists")
    public List<Map<String, Object>> getLists() {
        return listSentenceService.getLists(currentUserService.getCurrentUserId());
    }

    @PostMapping("/lists")
    public Map<String, Object> createList(@RequestBody @Valid ListRequest request) {
        return listSentenceService.createList(currentUserService.getCurrentUser(), request.name());
    }

    @PutMapping("/lists/{listId}")
    public Map<String, Object> renameList(@PathVariable Long listId, @RequestBody @Valid ListRequest request) {
        return listSentenceService.renameList(currentUserService.getCurrentUserId(), listId, request.name());
    }

    @DeleteMapping("/lists/{listId}")
    public ResponseEntity<Void> deleteList(@PathVariable Long listId) {
        listSentenceService.deleteList(currentUserService.getCurrentUserId(), listId);
        return ResponseEntity.noContent().build();
    }

    @GetMapping("/sentences/search")
    public List<Map<String, Object>> searchSentences(@RequestParam String q) {
        return listSentenceService.searchSentences(currentUserService.getCurrentUserId(), q);
    }

    @GetMapping("/lists/{listId}/sentences")
    public Object getSentences(
            @PathVariable Long listId,
            @RequestParam(required = false) Integer page,
            @RequestParam(required = false) Integer size
    ) {
        if (page != null && size != null) {
            return listSentenceService.getSentencesPaginated(
                    currentUserService.getCurrentUserId(), listId, page, size);
        }
        return listSentenceService.getSentences(currentUserService.getCurrentUserId(), listId);
    }

    @PostMapping("/lists/{listId}/sentences")
    public Map<String, Object> addSentence(@PathVariable Long listId, @RequestBody @Valid SentenceRequest request) {
        return listSentenceService.addSentence(currentUserService.getCurrentUserId(), listId, request.content());
    }

    @PutMapping("/sentences/{sentenceId}")
    public Map<String, Object> editSentence(@PathVariable Long sentenceId, @RequestBody @Valid SentenceRequest request) {
        return listSentenceService.editSentence(currentUserService.getCurrentUserId(), sentenceId, request.content());
    }

    @DeleteMapping("/sentences/{sentenceId}")
    public ResponseEntity<Void> deleteSentence(@PathVariable Long sentenceId) {
        listSentenceService.deleteSentence(currentUserService.getCurrentUserId(), sentenceId);
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/sentences/{sentenceId}/move")
    public Map<String, Object> moveSentence(@PathVariable Long sentenceId, @RequestBody @Valid MoveSentenceRequest request) {
        return listSentenceService.moveSentence(
                currentUserService.getCurrentUserId(),
                sentenceId,
                request.targetListId()
        );
    }

    @GetMapping("/sentences/{sentenceId}/video-links")
    public List<Map<String, Object>> getVideoLinks(@PathVariable Long sentenceId) {
        return sentenceVideoLinkService.getVideoLinks(currentUserService.getCurrentUserId(), sentenceId);
    }

    @PostMapping("/sentences/{sentenceId}/video-links")
    public Map<String, Object> addVideoLink(@PathVariable Long sentenceId, @RequestBody @Valid VideoLinkRequest request) {
        return sentenceVideoLinkService.addVideoLink(
                currentUserService.getCurrentUserId(),
                sentenceId,
                request.url(),
                request.timeCodeSeconds(),
                request.label()
        );
    }

    @DeleteMapping("/sentences/{sentenceId}/video-links/{linkId}")
    public ResponseEntity<Void> deleteVideoLink(@PathVariable Long sentenceId, @PathVariable Long linkId) {
        sentenceVideoLinkService.deleteVideoLink(currentUserService.getCurrentUserId(), linkId);
        return ResponseEntity.noContent().build();
    }

    public record ListRequest(@NotBlank String name) {
    }

    public record SentenceRequest(@NotBlank String content) {
    }

    public record MoveSentenceRequest(@NotNull Long targetListId) {
    }

    public record VideoLinkRequest(@NotBlank String url, Integer timeCodeSeconds, String label) {
    }
}
